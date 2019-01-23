import os
import copy
from django.utils import timezone
from collections import OrderedDict
import numpy as np
from scipy.optimize import linear_sum_assignment
from collections import OrderedDict
from distutils.util import strtobool
from xml.dom import minidom
from xml.sax.saxutils import XMLGenerator
from abc import ABCMeta, abstractmethod

import django_rq
from django.conf import settings
from django.db import transaction
import pdb

from . import models
from .task import get_frame_path
from .logging import task_logger, job_logger
import json

import pandas as pd

############################# Low Level server API

FORMAT_XML = 1
FORMAT_JSON = 2

def dump(tid, data_format, scheme, host):
    """
    Dump annotation for the task in specified data format.
    """
    queue = django_rq.get_queue('default')
    queue.enqueue_call(func=_dump, args=(tid, data_format, scheme, host),
        job_id="annotation.dump/{}".format(tid))

def check(tid):
    """
    Check that potentialy long operation 'dump' is completed.
    Return the status as json/dictionary object.
    """
    queue = django_rq.get_queue('default')
    job = queue.fetch_job("annotation.dump/{}".format(tid))
    if job is None:
        response = {"state": "unknown"}
    elif job.is_failed:
        # FIXME: here we have potential race. In general job.exc_info is
        # initialized inside handler but the method can be called before
        # that. By a reason exc_info isn't initialized by RQ python.
        response = {
            "state": "error",
            "stderr": job.exc_info}
    elif job.is_finished:
        response = {"state": "created"}
    else:
        response = {"state": "started"}

    return response

@transaction.atomic
def get(jid):
    """
    Get annotations for the job.
    """

    db_job = models.Job.objects.select_for_update().get(id=jid)
    annotation = _AnnotationForJob(db_job)
    annotation.init_from_db()

    #import wdb; wdb.set_trace()


    return annotation.to_client()

@transaction.atomic
def save_job(jid, data):
    """
    Save new annotations for the job.
    """
    db_job = models.Job.objects.select_for_update().get(id=jid)
    annotation = _AnnotationForJob(db_job)
    annotation.init_from_client(data)

    annotation.save_paths_to_db()
    db_job.segment.task.updated_date = timezone.now()
    db_job.updated_date = timezone.now()
    db_job.save()
    db_job.segment.task.save()

# pylint: disable=unused-argument
def save_task(tid, data):
    """
    Save new annotations for the task.
    """
    db_task = models.Task.objects.get(id=tid)
    db_segments = list(db_task.segment_set.prefetch_related('job_set').all())

    splitted_data = {}

    for segment in db_segments:
        jid = segment.job_set.first().id
        start = segment.start_frame
        stop = segment.stop_frame
        splitted_data[jid] = {
            "boxes": list(filter(lambda x: start <= x['frame'] <= stop, data['boxes'])),
            "tracks": list(filter(lambda x: len(list(filter(lambda y: (start <= y['frame'] <= stop) and (not y['outside']), x['boxes']))), data['tracks']))
        }

    for jid, _data in splitted_data.items():
        save_job(jid, _data)

# pylint: disable=unused-argument
def rq_handler(job, exc_type, exc_value, traceback):
    tid = job.id.split('/')[1]
    task_logger[tid].error("dump annotation error was occured", exc_info=True)

##################################################

names = ["nose",
        "left eye",
        "right eye",
        "left ear",
        "right ear",
        "left shoulder",
        "right shoulder",
        "left elbow",
        "right elbow",
        "left wrist",
        "right wrist",
        "left hip",
        "right hip",
        "left knee",
        "right knee",
        "left ankle",
        "right ankle",
        "center"];


class _Label:
    def __init__(self, db_label):
        self.id = db_label.id
        self.name = db_label.name

class _Attribute:
    def __init__(self, db_attr, value):
        self.id = db_attr.id
        self.name = db_attr.get_name()
        if db_attr.get_type() == 'checkbox':
            self.value = str(value).lower()
        else:
            self.value = str(value)

# Defining Skeleton and keypoint classes, attributes and methods
# May need to think a bit more about how to best merge skeletons.


class _Skeleton:
    def __init__(self, keypoints, frame,  attributes=None):
        self.keypoints = keypoints
        self.frame = frame
        self.attributes = attributes if attributes else []
        # Individual keypoints have "visibility" property
        # that includes possibility of "outside" value
        # but whole skeleton should also have this property
        

    # Not sure how to implement this for skeletons yet
    '''
    def merge(self, box):
        # The occluded property and attributes cannot be merged. Let's keep
        # original attributes and occluded property of the self object.
        assert self.frame == box.frame
        self.xtl = (self.xtl + box.xtl) / 2
        self.ytl = (self.ytl + box.ytl) / 2
        self.xbr = (self.xbr + box.xbr) / 2
        self.ybr = (self.ybr + box.ybr) / 2
    '''
    
    def add_attribute(self, attr):
        self.attributes.append(attr)


class _Keypoint:
    def __init__(self,name,x,y,frame, visibility,attributes=None):
        self.name = name
        self.x = x
        self.y = y
        self.frame = frame
        self.visibility = visibility
        self.attributes = attributes if attributes else []


class _LabeledSkeleton(_Skeleton):
    def __init__(self, label, keypoints, frame, attributes=None):
        super().__init__(keypoints, frame, attributes)
        self.label = label


class _TrackedSkeleton(_Skeleton):
    def __init__(self, keypoints, frame, outside, activity, attributes=None):
        super().__init__(keypoints, frame, attributes)
        self.outside = outside
        self.activity = activity

class _InterpolatedSkeleton(_TrackedSkeleton):
    def __init__(self, keypoints, frame, outside, keyframe, attributes=None):
        super().__init__(keypoints, frame, outside, attributes)
        self.keyframe = keyframe


class _BoundingBox:
    def __init__(self, x0, y0, x1, y1, frame, occluded, attributes=None):
        self.xtl = x0
        self.ytl = y0
        self.xbr = x1
        self.ybr = y1
        self.occluded = occluded
        self.frame = frame
        self.attributes = attributes if attributes else []

    def merge(self, box):
        # The occluded property and attributes cannot be merged. Let's keep
        # original attributes and occluded property of the self object.
        assert self.frame == box.frame
        self.xtl = (self.xtl + box.xtl) / 2
        self.ytl = (self.ytl + box.ytl) / 2
        self.xbr = (self.xbr + box.xbr) / 2
        self.ybr = (self.ybr + box.ybr) / 2

    def add_attribute(self, attr):
        self.attributes.append(attr)

class _LabeledBox(_BoundingBox):
    def __init__(self, label, x0, y0, x1, y1, frame, occluded, attributes=None):
        super().__init__(x0, y0, x1, y1, frame, occluded, attributes)
        self.label = label

class _TrackedBox(_BoundingBox):
    def __init__(self, x0, y0, x1, y1, frame, occluded, outside, attributes=None):
        super().__init__(x0, y0, x1, y1, frame, occluded, attributes)
        self.outside = outside

class _InterpolatedBox(_TrackedBox):
    def __init__(self, x0, y0, x1, y1, frame, occluded, outside, keyframe, attributes=None):
        super().__init__(x0, y0, x1, y1, frame, occluded, outside, attributes)
        self.keyframe = keyframe

class _ObjectPath:
    def __init__(self, label, start_frame, stop_frame, boxes=None, skeletons=None, attributes=None): #
        self.label = label
        self.frame = start_frame
        self.stop_frame = stop_frame
        self.boxes = boxes if boxes else []

        self.skeletons = skeletons if skeletons else []

        self.attributes = attributes if attributes else []
        self._interpolated_boxes = []
        #self._interpolated_skeletons = []
        '''
        assert not self.boxes or self.boxes[-1].frame <= self.stop_frame
        '''
        assert not self.boxes or self.boxes[-1].frame <= self.stop_frame \
            or not self.skeletons or self.skeletons[-1].frame <= self.stop_frame


    def add_box(self, box):
        self.boxes.append(box)

    def add_skeleton(self,skeleton):
        self.skeletons.append(skeleton)

    def get_interpolated_boxes(self):
        if not self._interpolated_boxes:
            self._init_interpolated_boxes()

        return self._interpolated_boxes
    '''
     def get_interpolated_skeletons(self):
         if not self._interpolated_skeletons:
             self._init_interpolated_skeletons()

         return self._interpolated_skeletons
    '''

    def _init_interpolated_boxes(self):
        assert self.boxes[-1].frame <= self.stop_frame

        boxes = []
        stop_box = copy.copy(self.boxes[-1])
        stop_box.frame = self.stop_frame + 1
        attributes = {}
        for box0, box1 in zip(self.boxes, self.boxes[1:] + [stop_box]):
            assert box0.frame < box1.frame

            distance = float(box1.frame - box0.frame)
            delta_xtl = (box1.xtl - box0.xtl) / distance
            delta_ytl = (box1.ytl - box0.ytl) / distance
            delta_xbr = (box1.xbr - box0.xbr) / distance
            delta_ybr = (box1.ybr - box0.ybr) / distance

            # New box doesn't have all attributes (only first one does).
            # Thus it is necessary to propagate them.
            for attr in box0.attributes:
                attributes[attr.id] = attr

            for frame in range(box0.frame, box1.frame):
                off = frame - box0.frame
                xtl = box0.xtl + delta_xtl * off
                ytl = box0.ytl + delta_ytl * off
                xbr = box0.xbr + delta_xbr * off
                ybr = box0.ybr + delta_ybr * off

                box = _InterpolatedBox(xtl, ytl, xbr, ybr, frame, box0.occluded,
                    box0.outside, box0.frame == frame, list(attributes.values()))
                boxes.append(box)

                if box0.outside:
                    break

        self._interpolated_boxes = boxes

    # def _init_interpolated_skeletons(self):
    #     assert self.skeletons[-1].frame <= self.stop_frame
    #
    #     skeletons = []
    #     stop_skeleton = copy.copy(self.skeletons[1])
    #     stop_skeleton.frame = self.stop_frame + 1
    #     attributes = {}
    #     for skel0, skel1 in zip(self.skeletons,self.skeletons[1:] + [stop_skeleton]):
    #         assert skel0.frame <= skel1.frame
    #
    #         ## LOGIC FOR INTERPOLATING SKELETONS GOES HERE
    #
    #         distance = float(skel1.frame - skel0.frame)
    #         deltas = []
    #         for (keyp0,keyp1) in zip(skel0.keypoints,skel1.keypoints):
    #             delta_x = (keyp1.x - keyp0.x)/distance
    #             delta_y = (keyp1.y - keyp0.x)/distance
    #             deltas.append((delta_x,delta_y))
    #
    #         # New box doesn't have all attributes (only first one does).
    #         # Thus it is necessary to propagate them.
    #
    #         for attr in skel0.attributes:
    #             attributes[attr.id] = attr
    #
    #         for frame in range(skel0.frame, skel1.frame):
    #             off = frame - skel0.frame
    #
    #             keypoints = []
    #
    #
    #         # Keypoints that are outside image shouldn't be interpolated,
    #         # but ones that aren't should be.
    #
    #             # (Same for the visibility of each of the keypoints)
    #             for i,(keyp0, keyp1) in enumerate(zip(skel0.keypoints, skel1.keypoints)):
    #
    #                 if not keyp0.visibility:
    #                     # i.e. keypoint is either occluded or visible
    #                     x = keyp0.x + deltas[i][0] * off
    #                     y = keyp0.y + deltas[i][1] * off
    #                 else:
    #                     x = keyp0.x
    #                     y = keyp0.y
    #
    #                 keypoint = _Keypoint(x, y, frame, skel0.keypoints[0].visibility)
    #                 keypoints.append(keypoint)
    #
    #                 skeleton = _InterpolatedSkeleton(keypoints,frame,box0.frame == frame,
    #                                                  list(attributes.values()))
    #                 skeletons.append(skeleton)
    #
    # TODO: IMPLEMENT FOR SKELETONS
    def merge(self, path):
        assert self.label.id == path.label.id
        boxes = {box.frame:box for box in self.boxes}
        for box in path.boxes:
            if box.frame in boxes:
                boxes[box.frame].merge(box)
            else:
                boxes[box.frame] = box

        self.frame = min(self.frame, path.frame)
        self.stop_frame = max(self.stop_frame, path.stop_frame)
        self.boxes = list(sorted(boxes.values(), key=lambda box: box.frame))
        self._interpolated_boxes = []

    def add_attribute(self, attr):
        self.attributes.append(attr)

class _Annotation:
    def __init__(self, start_frame, stop_frame):
        self.boxes = []
        self.paths = []
        self.skeletons = []
        self.skel_keypoints = []
        self.start_frame = start_frame
        self.stop_frame = stop_frame

    def reset(self):
        self.boxes = []
        self.skeletons = []
        self.skel_keypoints = []
        self.paths = []

    def to_boxes(self):
        boxes = []
        for path in self.paths:
            for box in path.get_interpolated_boxes():
                if not box.outside:
                    box = _LabeledBox(path.label, box.xtl, box.ytl, box.xbr, box.ybr,
                        box.frame, box.occluded, box.attributes + path.attributes)
                    boxes.append(box)

        return self.boxes + boxes

    def to_skeletons(self):
        skeletons = []
        for path in self.paths:
            for skeleton in path.get_interpolated_skeletons():
                # TODO: Check if not checking if any keypoints are outside is OK:
                skeleton  = _LabeledSkeleton(path.label,skeleton.keypoints,
                                             skeleton.frame,skeleton.attributes \
                                             + path.attributes)
                skeletons.append(skeleton)
        return self.skeletons + skeletons

    def to_paths(self):
        paths = []
        for box in self.boxes:
            box0 = _InterpolatedBox(box.xtl, box.ytl, box.xbr, box.ybr, box.frame,
                box.occluded, False, True)
            box1 = copy.copy(box0)
            box1.outside = True
            box1.frame += 1
            path = _ObjectPath(box.label, box.frame, box.frame + 1,
                               boxes = [box0, box1],
                               attributes = box.attributes)
            paths.append(path)

        # for skeleton in self.skeletons:
        #     skeleton0 = _InterpolatedSkeleton(skeleton.keypoints,skeleton.frame,
        #                                       False, True)
        #     skeleton1 = copy.copy(skeleton0)
        #     # TODO: no outsides
        #     skeleton1.frame += 1
        #     path = _ObjectPath(skeleton.label, skeleton.frame,skeleton.frame + 1,
        #                        skeletons = [skeleton0,skeleton1],
        #                        attributes = skeleton.attributes)

        return self.paths + paths


class _AnnotationForJob(_Annotation):
    def __init__(self, db_job):
        db_segment = db_job.segment
        super().__init__(db_segment.start_frame, db_segment.stop_frame)

        # pylint: disable=bad-continuation
        self.db_job = db_job
        self.logger = job_logger[db_job.id]
        self.db_labels = {db_label.id:db_label
            for db_label in db_job.segment.task.label_set.all()}
        self.db_attributes = {db_attr.id:db_attr
            for db_attr in models.AttributeSpec.objects.filter(
                label__task__id=db_job.segment.task.id)}

    def _merge_table_rows(self, rows, keys_for_merge, field_id):
        """dot.notation access to dictionary attributes"""
        class dotdict(OrderedDict):
            __getattr__ = OrderedDict.get
            __setattr__ = OrderedDict.__setitem__
            __delattr__ = OrderedDict.__delitem__
            __eq__ = lambda self, other: self.id == other.id
            __hash__ = lambda self: self.id

        # It is necessary to keep a stable order of original rows
        # (e.g. for tracked boxes). Otherwise prev_box.frame can be bigger
        # than next_box.frame.
        merged_rows = OrderedDict()

        # Group all rows by field_id. In grouped rows replace fields in
        # accordance with keys_for_merge structure.

        # rows is a list of dicts

        for row in rows:
            # for field_id == 'id': in our scenario grouped by track_id
            row_id = row[field_id]

            # Each element in merged_rows
            if not row_id in merged_rows:
                merged_rows[row_id] = dotdict(row)
                for key in keys_for_merge:
                    merged_rows[row_id][key] = []

            for key in keys_for_merge:
                item = dotdict({v.split('__', 1)[-1]:row[v] for v in keys_for_merge[key]})
                if item.id:
                    merged_rows[row_id][key].append(item)

        # Remove redundant keys from final objects
        redundant_keys = [item for values in keys_for_merge.values() for item in values]
        for i in merged_rows:
            for j in redundant_keys:
                del merged_rows[i][j]

        return list(merged_rows.values())


    def init_from_db(self):
        self.reset()

        db_paths = list(self.db_job.objectpath_set.prefetch_related('trackedskeleton_set')
                       .prefetch_related('objectpathattributeval_set')
                       .prefetch_related('trackedskeleton_set__trackedskeletonattributeval_set')
                        .values('id', 'frame',
                'objectpathattributeval__spec_id',
                'objectpathattributeval__id', 'objectpathattributeval__value',
                'trackedskeleton__id', 'label_id',
                'trackedskeleton__frame',
                'trackedskeleton__outside',
                'trackedskeleton__activity',
                'trackedskeleton__trackedskeletonattributeval__spec_id',
                'trackedskeleton__trackedskeletonattributeval__value',
                'trackedskeleton__trackedskeletonattributeval__id',
                                'trackedskeleton__keypoint__id',
                                'trackedskeleton__keypoint__visibility',
                                'trackedskeleton__keypoint__x',
                                'trackedskeleton__keypoint__y',
                                'trackedskeleton__keypoint__name')
            .order_by('id','trackedskeleton__frame'))

        keys_for_merge = {


            # The value of all of these attributes is None in 1st frame.
            # So resulting "attributes" list is empty.

            'attributes': [
                'objectpathattributeval__value',
                'objectpathattributeval__spec_id',
                'objectpathattributeval__id'
            ],

            # In this formulation, two rows are separated within
            # 'skeletons' list if any one of these attributes is different.
            # Thus skee
            'skeletons': [
                'trackedskeleton__keypoint__id',
                'trackedskeleton__frame',
                'trackedskeleton__activity',
                'trackedskeleton__id', 'trackedskeleton__keypoint__visibility',
                'trackedskeleton__keypoint__x', 'trackedskeleton__keypoint__y',
                'trackedskeleton__keypoint__name', 'trackedskeleton__outside',
                'trackedskeleton__trackedskeletonattributeval__value',
                'trackedskeleton__trackedskeletonattributeval__spec_id',
                'trackedskeleton__trackedskeletonattributeval__id'
            ]
        }

        # This seems to load the same keypoints twice if the keyframe contains
        # attribute values for 2 different attributes. Let's try
        # hackily checking kp already exists once we load it.

        # Grouping them here by TRACK id (I believe)
        db_paths = self._merge_table_rows(db_paths, keys_for_merge, 'id')

        keys_for_merge = {
            'attributes': [
                'trackedskeletonattributeval__value',
                'trackedskeletonattributeval__spec_id',
                'trackedskeletonattributeval__id'
            ],
            'keypoints':[
                'keypoint__id',
                'keypoint__x',
                'keypoint__y',
                'keypoint__visibility',
                'keypoint__name'
            ]
        }

        for db_path in db_paths: # Each db_path represents a SKELETON (with keypoints in 'skeletons'
                                 # field) given how this was coded
            db_path.skeletons = self._merge_table_rows(db_path.skeletons, keys_for_merge, 'id')
            db_path.attributes = list(set(db_path.attributes))
            for db_skel in db_path.skeletons:
                db_skel.attributes = list(set(db_skel.attributes))

        for db_path in db_paths:
            label = _Label(self.db_labels[db_path.label_id])
            path = _ObjectPath(label, db_path.frame, self.stop_frame)
            for db_attr in db_path.attributes:
                spec = self.db_attributes[db_attr.spec_id]
                attr = _Attribute(spec, db_attr.value)
                path.add_attribute(attr)

            frame = -1

            for db_skel in db_path.skeletons:

                db_keyps = []

                db_skel.keypoints = list(set(db_skel.keypoints))

                for db_keyp in db_skel.keypoints:

                    keyp = _Keypoint(db_keyp.name, db_keyp.x,db_keyp.y,
                                     db_skel.frame, db_keyp.visibility)

                    # This seems to load the same keypoints twice if the keyframe contains
                    # attribute values for 2 different attributes. Let's try
                    # hackily checking kp already exists in db_keyps.

                    db_keyps.append(keyp)


                skel = _TrackedSkeleton(db_keyps, db_skel.frame,
                                        db_skel.outside, db_skel.activity)

                # TODO: reliant on activity label placeholder for the moment



                assert skel.frame > frame
                frame = skel.frame

                for db_attr in db_skel.attributes:
                    spec = self.db_attributes[db_attr.spec_id]
                    attr = _Attribute(spec, db_attr.value)
                    skel.add_attribute(attr)

                path.add_skeleton(skel)

            self.paths.append(path)

    def init_from_client(self, data):
        # All fields inside data should be converted to correct type explicitly.
        # We cannot trust that client will send 23 as integer. Here we also
        # accept "23".
        self.reset()

        # Think this is just for frame-wise annotations
        for box in data['boxes']:
            label = _Label(self.db_labels[int(box['label_id'])])

            labeled_box = _LabeledBox(label, float(box['xtl']), float(box['ytl']),
                float(box['xbr']), float(box['ybr']), int(box['frame']),
                strtobool(str(box['occluded'])))

            for attr in box['attributes']:
                spec = self.db_attributes[int(attr['id'])]
                attr = _Attribute(spec, str(attr['value']))
                labeled_box.add_attribute(attr)

            self.boxes.append(labeled_box)

        for track in data['tracks']:
            label = _Label(self.db_labels[int(track['label_id'])])

            frame = -1

            boxes = []
            for box in track['boxes']:
                if int(box['frame']) <= self.stop_frame:
                    tracked_box = _TrackedBox(float(box['xtl']), float(box['ytl']),
                        float(box['xbr']), float(box['ybr']), int(box['frame']),
                        strtobool(str(box['occluded'])), strtobool(str(box['outside'])))
                    assert tracked_box.frame >  frame
                    frame = tracked_box.frame

                    for attr in box['attributes']:
                        spec = self.db_attributes[int(attr['id'])]
                        assert spec.is_mutable()
                        attr = _Attribute(spec, str(attr['value']))
                        tracked_box.add_attribute(attr)

                    boxes.append(tracked_box)
                else:
                    self.logger.error("init_from_client: ignore frame #%d " +
                        "because stop_frame is %d", box['frame'], self.stop_frame)

            skels = []
            for skel in track['skels']:

                keypoints = []
                if int(skel['frame']) <= self.stop_frame:

                    for keypoint,value in skel.items():

                        if keypoint in names:

                            keypoints.append(_Keypoint(keypoint, #its name
                                                         value[0],value[1],
                                                        skel['frame'],value[2]))

                    # Putting a placeholder in "outside" for now
                    tracked_skel = _TrackedSkeleton(keypoints,skel['frame'],
                                                    skel['outside'],skel['activity'])
                    assert tracked_skel.frame > frame
                    frame = tracked_skel.frame

                    for attr in skel['attributes']:
                        spec = self.db_attributes[int(attr['id'])]
                        assert spec.is_mutable()
                        attr = _Attribute(spec, str(attr['value']))
                        tracked_skel.add_attribute(attr)

                    skels.append(tracked_skel)

            attributes = []
            for attr in track['attributes']:
                spec = self.db_attributes[int(attr['id'])]
                assert not spec.is_mutable()
                attr = _Attribute(spec, str(attr['value']))
                attributes.append(attr)

            assert frame <= self.stop_frame


            object_path = _ObjectPath(label, int(track['frame']), self.stop_frame, boxes=boxes,
                                          skeletons = skels, attributes = attributes)
            self.paths.append(object_path)

    def save_boxes_to_db(self):
        self.db_job.labeledbox_set.all().delete()
        db_boxes = []
        db_attrvals = []

        for box in self.boxes:
            db_box = models.LabeledBox()
            db_box.job = self.db_job
            db_box.label = self.db_labels[box.label.id]
            db_box.frame = box.frame
            db_box.xtl = box.xtl
            db_box.ytl = box.ytl
            db_box.xbr = box.xbr
            db_box.ybr = box.ybr
            db_box.occluded = box.occluded

            for attr in box.attributes:
                db_attrval = models.LabeledBoxAttributeVal()
                db_attrval.box_id = len(db_boxes)
                db_attrval.spec = self.db_attributes[attr.id]
                db_attrval.value = attr.value
                db_attrvals.append(db_attrval)

            db_boxes.append(db_box)

        db_boxes = models.LabeledBox.objects.bulk_create(db_boxes)
        if db_boxes and db_boxes[0].id == None:
            # Try to get primary keys. Probably the code will work for sqlite
            # but it definetely doesn't work for Postgres. Need to say that
            # for Postgres bulk_create will return objects with ids even ids
            # are auto incremented. Thus we will not be inside the 'if'.
            db_boxes = list(self.db_job.labeledbox_set.all())
        for db_attrval in db_attrvals:
            db_attrval.box_id = db_boxes[db_attrval.box_id].id
        models.LabeledBoxAttributeVal.objects.bulk_create(db_attrvals)
    '''
    def save_skels_to_db(self):
        self.db_job.labeledskeleton_set.all().delete()
        db_skeletons = []
        db_attrvals = []

        for skel in self.skeletons:
            db_skel = models.LabeledSkeleton()
            db_skel = self.db_job
            db_skel.label = self.db_labels[skel.label.id]
            db_skel.frame = skel.frame
            for keypoint in keypoints:
    '''

    def save_paths_to_db(self):

        self.db_job.objectpath_set.all().delete()

        db_paths = []
        db_path_attrvals = []
        db_boxes = []
        db_skels = []
        db_box_attrvals = []
        db_skel_attrvals = []
        # Will be a list of lists containing each skel's keypoints
        db_skel_keypoints = []

        for path in self.paths:
            db_path = models.ObjectPath()
            db_path.job = self.db_job
            db_path.label = self.db_labels[path.label.id]
            db_path.frame = path.frame

            for attr in path.attributes:
                db_attrspec = self.db_attributes[attr.id]

                db_attrval = models.ObjectPathAttributeVal()
                db_attrval.track_id = len(db_paths)
                db_attrval.spec = db_attrspec
                db_attrval.value = attr.value

                db_path_attrvals.append(db_attrval)

            for box in path.boxes:
                db_box = models.TrackedBox()
                db_box.track_id = len(db_paths)
                db_box.xtl = box.xtl
                db_box.ytl = box.ytl
                db_box.xbr = box.xbr
                db_box.ybr = box.ybr
                db_box.frame = box.frame
                db_box.occluded = box.occluded
                db_box.outside = box.outside

                for attr in box.attributes:
                    db_attrspec = self.db_attributes[attr.id]

                    db_attrval = models.TrackedBoxAttributeVal()
                    db_attrval.box_id = len(db_boxes)
                    db_attrval.spec = db_attrspec
                    db_attrval.value = attr.value
                    db_box_attrvals.append(db_attrval)

                db_boxes.append(db_box)

            for skel in path.skeletons:
                db_skel = models.TrackedSkeleton()
                db_skel.track_id = len(db_paths)

                # What to do with keypoints? Think need to initialize them
                # after creating skeletons, then associate them with skels.
                db_skel.frame = skel.frame
                db_skel.activity = skel.activity
                db_skel.outside = skel.outside

                for attr in skel.attributes:
                    db_attrspec = self.db_attributes[attr.id]

                    db_attrval = models.TrackedSkeletonAttributeVal()
                    db_attrval.skel_id = len(db_skels)
                    db_attrval.spec = db_attrspec
                    db_attrval.value = attr.value
                    db_skel_attrvals.append(db_attrval)

                keyp_list = []

                for keypoint in skel.keypoints:
                    db_keyp = models.Keypoint()
                    db_keyp.name = keypoint.name
                    db_keyp.skeleton_id = len(db_skels)
                    db_keyp.x = keypoint.x
                    db_keyp.y = keypoint.y
                    db_keyp.visibility = keypoint.visibility
                    db_keyp.frame = keypoint.frame
                    keyp_list.append(db_keyp)

                db_skels.append(db_skel)
                db_skel_keypoints.append(keyp_list)

            db_paths.append(db_path)

        db_paths = models.ObjectPath.objects.bulk_create(db_paths)
        if db_paths and db_paths[0].id == None:
            # Try to get primary keys. Probably the code will work for sqlite
            # but it definetely doesn't work for Postgres. Need to say that
            # for Postgres bulk_create will return objects with ids even ids
            # are auto incremented. Thus we will not be inside the 'if'.
            db_paths = list(self.db_job.objectpath_set.all())
        for db_attrval in db_path_attrvals:
            db_attrval.track_id = db_paths[db_attrval.track_id].id
        models.ObjectPathAttributeVal.objects.bulk_create(db_path_attrvals)

        for db_box in db_boxes:
            db_box.track_id = db_paths[db_box.track_id].id

        for db_skel in db_skels:
            db_skel.track_id = db_paths[db_skel.track_id].id


        db_boxes = models.TrackedBox.objects.bulk_create(db_boxes)


        # Can't use bulk_create in this scenario!
        for db_skel in db_skels:
            db_skel.save()

        #if all(db_skels) and db_skels[0].id == None:
        saved_skels = list(models.TrackedSkeleton.objects.filter(track__job_id=self.db_job.id))

        # skeletons we added in this transaction
        for i,db_skel in enumerate(db_skels):
            # sets of keypoints added in this transaction
            #for db_keyp in db_skel_keypoints[db_skels.index(db_skel)]:
            for db_keyp in db_skel_keypoints[i]:
                
                db_keyp.skeleton_id = saved_skels[db_keyp.skeleton_id].id

            #models.Keypoint.objects.bulk_create(db_skel_keypoints[db_skels.index(db_skel)])
            models.Keypoint.objects.bulk_create(db_skel_keypoints[i])

                #new_db_skels.append(models.TrackedSkeleton.objects.save(db_skel))
        #db_skels = models.TrackedSkeleton.objects.bulk_create(db_skels)



        if db_boxes and db_boxes[0].id == None:
            # Try to get primary keys. Probably the code will work for sqlite
            # but it definetely doesn't work for Postgres. Need to say that
            # for Postgres bulk_create will return objects with ids even ids
            # are auto incremented. Thus we will not be inside the 'if'.
            db_boxes = list(models.TrackedBox.objects.filter(track__job_id=self.db_job.id))

        for db_attrval in db_box_attrvals:
            db_attrval.box_id = db_boxes[db_attrval.box_id].id
        models.TrackedBoxAttributeVal.objects.bulk_create(db_box_attrvals)

        for db_attrval in db_skel_attrvals:
            db_attrval.skeleton_id = db_skels[db_attrval.skel_id].id

        models.TrackedSkeletonAttributeVal.objects.bulk_create(db_skel_attrvals)

    def to_client(self):

        data = {"boxes": [], "tracks": []}
        for box in self.boxes:
            labeled_box = {
                "label_id": box.label.id,
                "xtl": box.xtl,
                "ytl": box.ytl,
                "xbr": box.xbr,
                "ybr": box.ybr,
                "occluded": box.occluded,
                "frame": box.frame,
                "attributes": [{
                    "id": attr.id,
                    "value": attr.value
                } for attr in box.attributes],
            }
            data["boxes"].append(labeled_box)

        for path in self.paths:
            skeletons = []
            for skeleton in path.skeletons:

                keypoints = []
                for keypoint in skeleton.keypoints:

                    js_keypoint = {
                        "x" : keypoint.x,
                        "y" : keypoint.y,
                        "visibility" : keypoint.visibility,
                        "name" : keypoint.name
                    }

                    keypoints.append(js_keypoint)

                tracked_skeleton = {
                    "frame" : skeleton.frame,
                    "activity" : skeleton.activity,
                    "keypoints" : keypoints,
                    "attributes": [{
                        "id": attr.id,
                        "value": attr.value
                    } for attr in skeleton.attributes],
                    "outside" : skeleton.outside,
                }

                skeletons.append(tracked_skeleton)

            track = {
                    "frame" : path.frame,
                    "skeletons" : skeletons,
                    "label" : path.label.id,
                    "attributes": [{
                    "id": attr.id,
                    "value": attr.value
                 } for attr in path.attributes]
            }

            data["tracks"].append(track)
        return data


class _AnnotationForSegment(_Annotation):
    def __init__(self, db_segment):
        super().__init__(db_segment.start_frame, db_segment.stop_frame)
        self.db_segment = db_segment

    def init_from_db(self):
        # FIXME: at the moment a segment has only one job always. Thus
        # the implementation makes sense. Need to implement a good one
        # in the future.
        self.reset()

        db_job0 = list(self.db_segment.job_set.all())[0]
        annotation = _AnnotationForJob(db_job0)
        annotation.init_from_db()
        self.boxes = annotation.boxes
        self.paths = annotation.paths


@transaction.atomic
def _dump(tid, data_format, scheme, host):
    db_task = models.Task.objects.select_for_update().get(id=tid)
    annotation = _AnnotationForTask(db_task)
    annotation.init_from_db()
    annotation.dump(data_format, db_task, scheme, host)

def _calc_box_area(box):
    return (box.xbr - box.xtl) * (box.ybr - box.ytl)

def _calc_overlap_box_area(box0, box1):
    dx = min(box0.xbr, box1.xbr) - max(box0.xtl, box1.xtl)
    dy = min(box0.ybr, box1.ybr) - max(box0.ytl, box1.ytl)
    if dx > 0 and dy > 0:
        return dx * dy
    else:
        return 0

def _calc_box_IoU(box0, box1):
    overlap_area = _calc_overlap_box_area(box0, box1)
    return overlap_area / (_calc_box_area(box0) + _calc_box_area(box1) - overlap_area)

class _AnnotationWriter:
    __metaclass__ = ABCMeta

    def __init__(self, file, version):
        self.version = version
        self.file = file

    @abstractmethod
    def open_root(self):
        raise NotImplementedError

    @abstractmethod
    def add_meta(self, meta):
        raise NotImplementedError

    @abstractmethod
    def open_track(self, track):
        raise NotImplementedError

    @abstractmethod
    def open_image(self, image):
        raise NotImplementedError

    @abstractmethod
    def open_box(self, box):
        raise NotImplementedError

    @abstractmethod
    def add_attribute(self, attribute):
        raise NotImplementedError

    @abstractmethod
    def close_box(self):
        raise NotImplementedError

    @abstractmethod
    def close_image(self):
        raise NotImplementedError

    @abstractmethod
    def close_track(self):
        raise NotImplementedError

    @abstractmethod
    def close_root(self):
        raise NotImplementedError

class _XmlAnnotationWriter(_AnnotationWriter):
    def __init__(self, file):
        super().__init__(file, "1.0")
        self.xmlgen = XMLGenerator(self.file, 'utf-8')
        self._level = 0

    def _indent(self, newline = True):
        if newline:
            self.xmlgen.ignorableWhitespace("\n")
        self.xmlgen.ignorableWhitespace("  " * self._level)

    def _add_version(self):
        self._indent()
        self.xmlgen.startElement("version", {})
        self.xmlgen.characters(self.version)
        self.xmlgen.endElement("version")

    def open_root(self):
        self.xmlgen.startDocument()
        self.xmlgen.startElement("annotations", {})
        self._level += 1
        self._add_version()

    def _add_meta(self, meta):
        self._level += 1
        for k, v in meta.items():
            if isinstance(v, OrderedDict):
                self._indent()
                self.xmlgen.startElement(k, {})
                self._add_meta(v)
                self._indent()
                self.xmlgen.endElement(k)
            elif type(v) == list:
                self._indent()
                self.xmlgen.startElement(k, {})
                for tup in v:
                    self._add_meta(OrderedDict([tup]))
                self._indent()
                self.xmlgen.endElement(k)
            else:
                self._indent()
                self.xmlgen.startElement(k, {})
                self.xmlgen.characters(v)
                self.xmlgen.endElement(k)
        self._level -= 1

    def add_meta(self, meta):
        self._indent()
        self.xmlgen.startElement("meta", {})
        self._add_meta(meta)
        self._indent()
        self.xmlgen.endElement("meta")

    def open_track(self, track):
        self._indent()
        self.xmlgen.startElement("track", track)
        self._level += 1

    def open_image(self, image):
        self._indent()
        self.xmlgen.startElement("image", image)
        self._level += 1

    def open_box(self, box):
        self._indent()
        self.xmlgen.startElement("box", box)
        self._level += 1

    def add_attribute(self, attribute):
        self._indent()
        self.xmlgen.startElement("attribute", {"name": attribute["name"]})
        self.xmlgen.characters(attribute["value"])
        self.xmlgen.endElement("attribute")

    def close_box(self):
        self._level -= 1
        self._indent()
        self.xmlgen.endElement("box")

    def close_image(self):
        self._level -= 1
        self._indent()
        self.xmlgen.endElement("image")

    def close_track(self):
        self._level -= 1
        self._indent()
        self.xmlgen.endElement("track")

    def close_root(self):
        self._level -= 1
        self._indent()
        self.xmlgen.endElement("annotations")
        self.xmlgen.endDocument()

class _AnnotationForTask(_Annotation):
    def __init__(self, db_task):
        super().__init__(0, db_task.size)
        self.db_task = db_task

    def init_from_db(self):
        self.reset()

        for db_segment in self.db_task.segment_set.all():
            annotation = _AnnotationForSegment(db_segment)
            annotation.init_from_db()
            self._merge_boxes(annotation.boxes, db_segment.start_frame,
                self.db_task.overlap)
            self._merge_paths(annotation.paths, db_segment.start_frame,
                self.db_task.overlap)

    def _merge_paths(self, paths, start_frame, overlap):
        # 1. Split paths on two parts: new and which can be intersected
        # with existing paths.
        new_paths = [path for path in paths
            if path.frame >= start_frame + overlap]
        int_paths = [path for path in paths
            if path.frame < start_frame + overlap]
        assert len(new_paths) + len(int_paths) == len(paths)

        # 4. Find old paths which are intersected with int_paths
        old_paths = []
        for path in self.paths:
            box = path.get_interpolated_boxes()[-1]
            if box.frame >= start_frame:
                old_paths.append(path)

        # 3. Add new paths as is. It should be done only after old_paths
        # variable is initialized.
        self.paths.extend(new_paths)

        # Nothing to merge. Just add all int_paths if any.
        if not old_paths or not int_paths:
            self.paths.extend(int_paths)
            return

        # 4. Build cost matrix for each path and find correspondence using
        # Hungarian algorithm.
        min_cost_thresh = 0.5
        cost_matrix = np.empty(shape=(len(int_paths), len(old_paths)),
            dtype=float)
        for i, int_path in enumerate(int_paths):
            for j, old_path in enumerate(old_paths):
                cost_matrix[i][j] = 1
                if int_path.label.id == old_path.label.id:
                    # Here start_frame is the start frame of next segment
                    # and stop_frame is the stop frame of current segment
                    stop_frame = start_frame + overlap - 1
                    int_boxes = int_path.get_interpolated_boxes()
                    old_boxes = old_path.get_interpolated_boxes()
                    int_boxes = {box.frame:box for box in int_boxes if box.frame <= stop_frame}
                    old_boxes = {box.frame:box for box in old_boxes if box.frame >= start_frame}
                    assert int_boxes and old_boxes

                    count, error = 0, 0
                    for frame in range(start_frame, stop_frame + 1):
                        box0, box1 = int_boxes.get(frame), old_boxes.get(frame)
                        if box0 and box1:
                            if box0.outside != box1.outside:
                                error += 1
                            else:
                                error += 1 - _calc_box_IoU(box0, box1)
                            count += 1
                        elif box0 or box1:
                            error += 1
                            count += 1

                    cost_matrix[i][j] = error / count

        # 6. Find optimal solution using Hungarian algorithm.
        row_ind, col_ind = linear_sum_assignment(cost_matrix)
        int_paths_indexes = list(range(0, len(int_paths)))
        for i, j in zip(row_ind, col_ind):
            # Reject the solution if the cost is too high. Remember
            # inside int_boxes_indexes boxes which were handled.
            if cost_matrix[i][j] <= min_cost_thresh:
                old_paths[j].merge(int_paths[i])
                int_paths_indexes[i] = -1

        # 7. Add all paths which were not processed.
        for i in int_paths_indexes:
            if i != -1:
                self.paths.append(int_paths[i])

    def _merge_boxes(self, boxes, start_frame, overlap):
        # 1. Split boxes on two parts: new and which can be intersected
        # with existing boxes.
        new_boxes = [box for box in boxes
            if box.frame >= start_frame + overlap]
        int_boxes = [box for box in boxes
            if box.frame < start_frame + overlap]
        assert len(new_boxes) + len(int_boxes) == len(boxes)

        # 2. Convert to more convenient data structure (boxes by frame)
        int_boxes_by_frame = {}
        for box in int_boxes:
            if box.frame in int_boxes_by_frame:
                int_boxes_by_frame[box.frame].append(box)
            else:
                int_boxes_by_frame[box.frame] = [box]

        old_boxes_by_frame = {}
        for box in self.boxes:
            if box.frame >= start_frame:
                if box.frame in old_boxes_by_frame:
                    old_boxes_by_frame[box.frame].append(box)
                else:
                    old_boxes_by_frame[box.frame] = [box]

        # 3. Add new boxes as is. It should be done only after old_boxes_by_frame
        # variable is initialized.
        self.boxes.extend(new_boxes)

        # Nothing to merge here. Just add all int_boxes if any.
        if not old_boxes_by_frame or not int_boxes_by_frame:
            self.boxes.extend(int_boxes)
            return

        # 4. Build cost matrix for each frame and find correspondence using
        # Hungarian algorithm. In this case min_cost_thresh is stronger
        # because we compare only on one frame.
        min_cost_thresh = 0.25
        for frame in int_boxes_by_frame:
            if frame in old_boxes_by_frame:
                int_boxes = int_boxes_by_frame[frame]
                old_boxes = old_boxes_by_frame[frame]
                cost_matrix = np.empty(shape=(len(int_boxes), len(old_boxes)),
                    dtype=float)
                # 5.1 Construct cost matrix for the frame.
                for i, box0 in enumerate(int_boxes):
                    for j, box1 in enumerate(old_boxes):
                        if box0.label.id == box1.label.id:
                            cost_matrix[i][j] = 1 - _calc_box_IoU(box0, box1)
                        else:
                            cost_matrix[i][j] = 1

                # 6. Find optimal solution using Hungarian algorithm.
                row_ind, col_ind = linear_sum_assignment(cost_matrix)
                int_boxes_indexes = list(range(0, len(int_boxes)))
                for i, j in zip(row_ind, col_ind):
                    # Reject the solution if the cost is too high. Remember
                    # inside int_boxes_indexes boxes which were handled.
                    if cost_matrix[i][j] <= min_cost_thresh:
                        old_boxes[j].merge(int_boxes[i])
                        int_boxes_indexes[i] = -1

                # 7. Add all boxes which were not processed.
                for i in int_boxes_indexes:
                    if i != -1:
                        self.boxes.append(int_boxes[i])
            else:
                # We don't have old boxes on the frame. Let's add all new ones.
                self.boxes.extend(int_boxes_by_frame[frame])

    def dump(self, data_format, db_task, scheme, host):
        db_segments = db_task.segment_set.all().prefetch_related('job_set')
        db_labels = db_task.label_set.all().prefetch_related('attributespec_set')


        # Note: This code modified to output (JSON) keypoint annotations in
        # Microsoft COCO format. (c.f. http://cocodataset.org/#format-data )
        '''
        meta = OrderedDict([
            ("task", OrderedDict([
                ("id", str(db_task.id)),
                ("name", db_task.name),
                ("size", str(db_task.size)),
                ("mode", db_task.mode),
                ("overlap", str(db_task.overlap)),
                ("bugtracker", db_task.bug_tracker),
                ("created", str(timezone.localtime(db_task.created_date))),
                ("updated", str(timezone.localtime(db_task.updated_date))),

                ("labels", [
                    ("label", OrderedDict([
                        ("name", db_label.name),
                        ("attributes", [("attribute", db_attr.text)
                            for db_attr in db_label.attributespec_set.all()])
                    ])) for db_label in db_labels
                ]),

                ("segments", [
                    ("segment", OrderedDict([
                        ("id", str(db_segment.id)),
                        ("start", str(db_segment.start_frame)),
                        ("stop", str(db_segment.stop_frame)),
                        ("url", "{0}://{1}/?id={2}".format(
                            scheme, host, db_segment.job_set.all()[0].id))
                    ])) for db_segment in db_segments
                ]),

                ("owner", OrderedDict([
                    ("username", db_task.owner.username),
                    ("email", db_task.owner.email)
                ])),
            ])),
            ("dumped", str(timezone.localtime(timezone.now())))
        ])
        '''
        annotationjson = {}
        # Placeholders
        annotationjson['info'] = {u'description': u'COCO 2017 Dataset',
                                  u'url': u'http://cocodataset.org',
                                  u'version': u'1.0', u'year': 2017,
                                  u'contributor': u'COCO Consortium',
                                  u'date_created': u'2017/09/01'}
        annotationjson['licenses'] = [{u'url': u'http://creativecommons.org/licenses/by-nc-sa/2.0/',
                                       u'id': 1,
                                       u'name': u'Attribution-NonCommercial-ShareAlike License'},
                                      {u'url': u'http://creativecommons.org/licenses/by-nc/2.0/',
                                       u'id': 2, u'name': u'Attribution-NonCommercial License'},
                                      {u'url': u'http://creativecommons.org/licenses/by-nc-nd/2.0/',
                                       u'id': 3, u'name': u'Attribution-NonCommercial-NoDerivs License'},
                                      {u'url': u'http://creativecommons.org/licenses/by/2.0/',
                                       u'id': 4, u'name': u'Attribution License'},
                                      {u'url': u'http://creativecommons.org/licenses/by-sa/2.0/',
                                       u'id': 5, u'name': u'Attribution-ShareAlike License'},
                                      {u'url': u'http://creativecommons.org/licenses/by-nd/2.0/',
                                       u'id': 6, u'name': u'Attribution-NoDerivs License'},
                                      {u'url': u'http://flickr.com/commons/usage/',
                                       u'id': 7, u'name': u'No known copyright restrictions'},
                                      {u'url': u'http://www.usa.gov/copyright.shtml',
                                       u'id': 8, u'name': u'United States Government Work'}]

        # Will be filled in via parsing db annotations
        annotationjson['images'] = []
        annotationjson['annotations'] = []

        # keypoints we annotated. Correspond to COCO indexes 0 and 2-13 (so 13 in total)
        keypointsnames = ["nose", "left shoulder", "right shoulder", "left elbow", "right elbow",
                     "left wrist", "right wrist", "left hip", "right hip", "left knee",
                     "right knee", "left ankle", "right ankle", "center"]

        #All of our jobs should just have one segment.
        # = models.Job.objects.select_for_update().get(segment_id=db_segments[0].id).id

        #
        satisfactories = pd.read_csv('satisfactory_vids.csv')
        satisfactories = satisfactories[satisfactories['status'] == '2']

        db_jobs = models.Job.objects.select_for_update().filter(id__in=list(satisfactories['cvatjobid']))

        #db_jobs = models.Job.objects.select_for_update().all()

        def pair(x, y):
            return ((x + y) * (x + y + 1) / 2) + y

        for db_job in db_jobs:

            db_job_id = db_job.id

            # object_paths are individual tracks belonging to a job.
            object_paths = models.ObjectPath.objects.select_for_update().filter(job_id=db_job_id)

            for object_path in object_paths:

                # resulting TrackedSkeletons are skeletons of individual frames belonging to
                # object_path-identified track.
                db_skels = models.TrackedSkeleton.objects.select_for_update().filter(track_id=
                             object_path.id).order_by('frame')

                def keyporder(elem):
                    return keypointsnames.index(elem.name)

                current_frame = 0
                current_kf = {}
                for db_skel in db_skels:

                    # Generate using Cantor's pairing function:
                    # - image id, from job_id and frame. We need both job id and frame later.
                    # - annot.id, from skeleton ("detection id") and object path ("tracking id").
                    #   so we can retrieve track id while retaining distinctive id
                    #   for each annotation object.

                    image = {'license' : 3,
                              'file_name' : str(pair(db_job_id,db_skel.frame)),
                              'coco_url' : '',
                              'height' : 0,
                              'width' : 0,
                              'date_captured' : '',
                              'flickr_url' : '',
                              'id' : pair(db_job_id,db_skel.frame)}

                    if image not in annotationjson['images']:
                        annotationjson['images'].append(image)

                    # Get keypoint locations for current (key) frame
                    db_keypoints = models.Keypoint.objects.select_for_update().filter(skeleton_id=db_skel.id)
                    db_keypoints = sorted(db_keypoints,key=keyporder)

                    annotations = {'segmentation': [[]],
                                   'num_keypoints': 13,
                                   'area': 0,
                                   'iscrowd': 0,
                                   'keypoints': [], # Should be of length 39 when created
                                   'image_id': image['id'],
                                   'bbox': [],
                                   'category_id' : 1,
                                   'id': pair(object_path.id,db_skel.skeleton_ptr.id)}

                    for keypoint in db_keypoints:
                        annotations['keypoints'].append(keypoint.x)
                        annotations['keypoints'].append(keypoint.y)
                        annotations['keypoints'].append(keypoint.visibility)

                    annotationjson['annotations'].append(annotations)

            # TODO: need to also generate interpolated keypoint positions.

            #nm = list(satisfactories[satisfactories['cvatjobid'] == db_job.id]['videoname'])[0]

        json.dump(annotationjson,open('annotations.json','w'))

        #dump_path = self.db_task.get_dump_path()

        '''
        #with open(dump_path, "w") as dump_file:
            dumper = _XmlAnnotationWriter(dump_file)
            dumper.open_root()
            dumper.add_meta(meta)

            if self.db_task.mode == "annotation":
                boxes = {}
                for box in self.to_boxes():
                    if box.frame in boxes:
                        boxes[box.frame].append(box)
                    else:
                        boxes[box.frame] = [box]

                for frame in sorted(boxes):
                    link = get_frame_path(self.db_task.id, frame)
                    path = os.readlink(link)

                    rpath = path.split(os.path.sep)
                    rpath = os.path.sep.join(rpath[rpath.index(".upload")+1:])

                    dumper.open_image(OrderedDict([
                        ("id", str(frame)),
                        ("name", rpath)
                    ]))
                    for box in boxes[frame]:
                        dumper.open_box(OrderedDict([
                            ("label", box.label.name),
                            ("xtl", "{:.2f}".format(box.xtl)),
                            ("ytl", "{:.2f}".format(box.ytl)),
                            ("xbr", "{:.2f}".format(box.xbr)),
                            ("ybr", "{:.2f}".format(box.ybr)),
                            ("occluded", str(int(box.occluded)))
                        ]))
                        for attr in box.attributes:
                            dumper.add_attribute(OrderedDict([
                                ("name", attr.name),
                                ("value", attr.value)
                            ]))
                        dumper.close_box()
                    dumper.close_image()
            else:
                paths = self.to_paths()
                for idx, path in enumerate(paths):
                    dumper.open_track(OrderedDict([
                        ("id", str(idx)),
                        ("label", path.label.name)
                    ]))
                    for box in path.get_interpolated_boxes():
                        dumper.open_box(OrderedDict([
                            ("frame", str(box.frame)),
                            ("xtl", "{:.2f}".format(box.xtl)),
                            ("ytl", "{:.2f}".format(box.ytl)),
                            ("xbr", "{:.2f}".format(box.xbr)),
                            ("ybr", "{:.2f}".format(box.ybr)),
                            ("outside", str(int(box.outside))),
                            ("occluded", str(int(box.occluded))),
                            ("keyframe", str(int(box.keyframe)))
                        ]))
                        for attr in path.attributes + box.attributes:
                            dumper.add_attribute(OrderedDict([
                                ("name", attr.name),
                                ("value", attr.value)
                            ]))
                        dumper.close_box()
                    dumper.close_track()

            dumper.close_root()
        '''
