/* exported TrackModel MIN_BOX_SIZE */
"use strict";

/*worker ~select=type:__undefined__,bend, sit,d */

const MIN_BOX_SIZE = 3;

class TrackModel extends Listener {
    constructor(shapeType, data, id, labelsInfo, stopFrame, startFrame, colors) {
        super('onTrackUpdate', getState);
        this._id = id;
        //this._shape = TrackModel.createShape(shapeType, data.boxes);
        this._shapeType = shapeType;

        if (this._shapeType == 'skel'){
            this._shape = TrackModel.createShape(shapeType, data.skels);
        }
        else{
            this._shape = TrackModel.createShape(shapeType, data.boxes);
        }

        this._firstFrame = TrackModel.computeFirstFrame(this._shape._positionJournal);


        this._type = 'interpolation';
        //TODO: hopefully this doesn't cause any issues
        //this._type = TrackModel.computeFrameCount(stopFrame, this._shape._positionJournal) <= 1 ? 'annotation' : 'interpolation';
        this._label = +data.label;
        this._lock = false;
        this._removed = false;
        this._active = false;
        this._activeKeypoint = null;
        this._merge = false;
        this._hidden = false;
        this._hiddenLabel = false;
        this._selected = false;
        this._activeAAMTrack = false;
        this._activeAttribute = null;

        this._stopFrame = stopFrame;
        this._startFrame = startFrame;
        this._labelsInfo = labelsInfo;
        this._attributes = {
            mutable: this.fillMutableAttributes(data.attributes),
            immutable: this.fillImmutableAttributes(data.attributes)
        };
        this._curFrame = null;
        this._colors = colors;

        this._keypoint_names = ["nose",
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
        let self = this;
        function getState() {
            let state = {
                lock: self._lock,
                removed: self._removed,
                active: self._active,
                merge: self._merge,
                selected: self._selected,
                lockMerge: self._lockMerge,
                attributes: self.interpolateAttributes(),
                id: self._id,
                position: self._shape.interpolatePosition(this._curFrame, this._firstFrame),
                model: self
            };
            self._selected = false;
            return state;
        }
    }

    _normalizeMutableAttr() {
        if (!Number.isInteger(this._firstFrame)) {
            // track is invisible on the all frames
            return;
        }

        let attrList = this._attributes.mutable;
        for (let attrId in attrList) {
            let firstKey = +Object.keys(attrList[attrId])[0];
            if (firstKey != this._firstFrame) {
                attrList[attrId][this._firstFrame] = attrList[attrId][firstKey];
                delete attrList[attrId][firstKey];
            }
        }
    }

    set outside(value) {
        if (this._activeAAMTrack || this._lock) return;
        if (value != true && value != false) {
            throw new Error('Bad value');
        }
        const pos = this._shape.interpolatePosition(this._curFrame, this._firstFrame);
        let newPos = {
            skel: pos.skel,
            outsided: value ? 1 : 0,
            occluded: 0
        };
        this.recordPosition(newPos, this._curFrame);
        this._firstFrame = TrackModel.computeFirstFrame(this._shape._positionJournal);
        this._normalizeMutableAttr();
        this.notify();
    }

    set occluded(value) {
        if (value != true && value != false) {
            throw new Error('Bad value');
        }

        if (this._lock) return;

        const pos = this._shape.interpolatePosition(this._curFrame, this._firstFrame);
        let newPos = {
            xtl: pos.xtl,
            ytl: pos.ytl,
            xbr: pos.xbr,
            ybr: pos.ybr,
            outsided: pos.outsided,
            occluded: value ? 1 : 0
        };

        this.recordPosition(newPos, this._curFrame);
        this.notify();
    }

    set hidden(value) {
        if (value != true && value != false) {
            throw new Error('Bad value');
        }
        this._hidden = value;
        this.notify();
    }

    set hiddenLabel(value) {
        if (value != true && value != false) {
            throw new Error('Bad value');
        }
        this._hiddenLabel = value;
        this.notify();
    }

    set lock(value) {
        if (value != true && value != false) {
            throw new Error('Bad lock value');
        }
        if (this._activeAAMTrack) return;
        this._lock = value;
        this.notify();
    }

    set active(value) {
        if (value != true && value != false) {
            throw new Error('Bad active value');
        }
        this._active = value;
        this.notify();
    }

    set activeKeypoint(value){
        /*
        if (value != true && value != false) {
            throw new Error('Bad active value');
        }*/
        this._activeKeypoint = value;
        this.notify();

    }

    set activeAAMTrack(value) {
        if (value != true && value != false) {
            throw new Error('Bad merge value');
        }
        this._activeAAMTrack = value;
        if (this._activeAAMTrack) this._active = true;
        this.notify();
    }

    set merge(value) {
        if (value != true && value != false) {
            throw new Error('Bad merge value');
        }
        this._merge = value;
        this.notify();
    }

    set curFrame(value) {
        if (value < this._startFrame || value > this._stopFrame) {
            throw Error('Frame in track model out of job range');
        }
        this._curFrame = value;
    }

    set activeAttribute(attrKey) {
        if (Number.isInteger(attrKey) || attrKey === null) {
            this._activeAttribute = attrKey;
            this.notify();
            return;
        }
        throw new Error('Bad active attribute value');
    }

    set colors(colors) {
        if (typeof(colors) === 'object' && typeof(colors.border) === 'string' &&
                                       typeof(colors.background) === 'string') {
            this._colors = colors;
            this.notify();
            return;
        }
        else throw new Error('Bad colors value was occured');
    }

    set keyFrame(value) {
        if (this._activeAAMTrack || this._lock) return;
        if (value != true && value != false) {
            throw new Error(`Value must be boolean, but ${typeof(value)} extracted.`);
        }

        if (this._shape.setKeyFrame(value, this._curFrame, this._firstFrame) && !value) {
            // remove attr record
            let attrList = this._attributes.mutable;
            for (let attrId in attrList) {
                if (this._curFrame in attrList[attrId] && Object.keys(attrList[attrId]).length > 1) {
                    delete attrList[attrId][this._curFrame];
                }
            }
        }

        this._firstFrame = TrackModel.computeFirstFrame(this._shape._positionJournal);
        this._normalizeMutableAttr();
        this.notify();
    }


    get nextKeyFrame() {
        let next = TrackModel.computPrevNextFrames(this._curFrame, this._shape._positionJournal)[1];
        return next;
    }

    get prevKeyFrame() {
        let prev = TrackModel.computPrevNextFrames(this._curFrame, this._shape._positionJournal)[0];
        if (prev < this._firstFrame) return this._firstFrame;
        return prev;
    }

    get activeAttribute() {
        return this._activeAttribute;
    }

    get activeAAMTrack() {
        return this._activeAAMTrack;
    }

    get merge() {
        return this._merge;
    }

    get colors() {
        return this._colors;
    }

    get lock() {
        return this._lock;
    }

    get trackType() {
        return this._type;
    }

    get firstFrame() {
        return this._firstFrame;
    }

    get shapeType() {
        return this._shapeType;
    }

    get label() {
        return this._label;
    }

    get id() {
        return this._id;
    }

    get removed() {
        return this._removed;
    }

    get journal() {
        return this._shape._positionJournal;
    }

    get outside() {
        const pos = this._shape.interpolatePosition(this._curFrame, this._firstFrame);
        return pos.outsided;
    }

    get occluded() {
        const pos = this._shape.interpolatePosition(this._curFrame, this._firstFrame);
        return pos.occluded;
    }

    get hidden() {
        return this._hidden;
    }

    get hiddenLabel() {
        return this._hiddenLabel;
    }

    get attributes() {
        return this._attributes;
    }

    reinitialize(newlabel) {
        this._label = newlabel;
        this._attributes = {
            mutable: this.fillMutableAttributes( []),
            immutable: this.fillImmutableAttributes([])
        };

        //TODO: need to put
    }

    getStatToObject(statObj) {
        let labelName = this._labelsInfo.labels()[this._label];
        statObj[labelName].tracks ++;
        let frameCount = TrackModel.computeFrameCount(this._stopFrame, this._shape._positionJournal);

        let posKeys =  Object.keys(this._shape._positionJournal);
        let manually = posKeys.length;
        for (let key of posKeys) {
            if (this._shape._positionJournal[key].outsided) {
                manually --;
            }
        }

        let interpolated = frameCount - manually;
        statObj[labelName].manuallyShapes += manually;
        statObj[labelName].interpolatedShapes += interpolated;
    }

    export() {

        let positions = this._shape.export();
        let immutable = this._attributes.immutable;
        let mutable = this._attributes.mutable;

        if (this.trackType == "annotation") {
            let attributes = [];
            for (let key in immutable) {
                attributes.push({
                    id: +key,
                    value: immutable[key]
                });
            }

            for (let key in mutable) {
                for (let frame in mutable[key]) {
                    attributes.push({
                        id: +key,
                        value: mutable[key][frame]
                    });
                }
            }

            let frame = this._firstFrame;
            let pos = positions[frame];

            var labeled_box = {
                "label_id": this.label,
                "frame": frame,
                "xtl": pos[0],
                "ytl": pos[1],
                "xbr": pos[2],
                "ybr": pos[3],
                "occluded": pos[4],
                "attributes": attributes,
            };

            return labeled_box;
        } else {


            let attributes = [];
            for (let key in immutable) {
                attributes.push({
                    id: +key,
                    value: immutable[key]
                });
            }

            var track = {
                "label_id": this.label,
                "frame": this._firstFrame,
                "attributes": attributes,
                "boxes": [],
            };

            if (this._shapeType == 'skel') {

                track["skels"] = [];
            }
            else {

                track["boxes"] = [];
            }

            for (let frame in positions) {
                let attributes = [];
                for (let key in mutable) {
                    if (mutable[key][frame]) {
                        attributes.push({
                            id: +key,
                            value: mutable[key][frame]
                        });
                    }
                }

                let pos = positions[frame]['skels'];

                var frame_attributes = {
                    "frame": +frame,
                    "attributes": attributes,
                }

                var tmp = {};

                if (this._shapeType == 'skel') {

                    tmp['outside'] = this._shape._positionJournal[frame].outsided;
                    tmp['activity'] = positions[frame]['activity'];

                    for (var i = 0; i < pos.length; i++) {

                        //x, y, visibility
                        tmp[pos[i][3]] = [pos[i][0],
                                          pos[i][1],
                                          pos[i][2]];
                    };
                }
                else
                    {
                        tmp = {
                            "xtl": pos[0],
                            "ytl": pos[1],
                            "xbr": pos[2],
                            "ybr": pos[3],
                            "occluded": pos[4],
                            "outside": pos[5]
                        };
                    };

                    var tracked_box = Object.assign({}, tmp, frame_attributes);

                    if (this._shapeType == 'skel') {
                        track["skels"].push(tracked_box);

                        //TODO : make this placeholder a true activity value

                    } else {
                        track["boxes"].push(tracked_box);
                    }
                };
            }

            return track;

        }


    remove(force) {
        if ((!force && this._lock) || this._activeAAMTrack) return;
        let deleteObjectEvent = Logger.addContinuedEvent(Logger.EventType.deleteObject, {count: 1});
        this._removed = true;
        this.notify();
        deleteObjectEvent.close();
    }

    recordAttribute(attrKey, attrValue) {
        let attrInfo = this._labelsInfo.attrInfo(attrKey);
        if (attrInfo.mutable) {
            this._attributes.mutable[attrKey][this._curFrame] = attrValue;
            this.recordPosition(this._shape.interpolatePosition(this._curFrame, this._firstFrame));
        }
        else {
            this._attributes.immutable[attrKey] = attrValue;
        }
        this.notify();
    }

    recordPosition(pos) {
        this._shape.recordPosition(pos, this._curFrame);
    }

    recordKeypointPosition(pos,ind){
        this._shape.recordKeypointPosition(pos,ind,this._curFrame);
    }


    isKeyFrame(frame) {
        if (frame in this._shape._positionJournal) return true;
    }


    interpolate(frame) {
        // Just doing this outside the decl
        //let position = this._shape.interpolatePosition(frame, this._firstFrame)

        let interpolation = {
            attributes: this.interpolateAttributes(),
            position: this._shape.interpolatePosition(frame, this._firstFrame)
        };
        return interpolation;
    }


    interpolateAttributes() {
        let attributeList = new Object();
        let attributeNames = this._labelsInfo.attributes();
        for (let attrKey in this._attributes.immutable) {
            attributeList[attrKey] = {
                name: attributeNames[attrKey],
                value: this._attributes.immutable[attrKey],
            };
        }

        for (let attrKey in this._attributes.mutable) {
            let prevKey = null;
            for (let frameKey in this._attributes.mutable[attrKey]) {
                if (this._curFrame >= +frameKey) prevKey = frameKey;
                else break;
            }
            if (prevKey) {
                attributeList[attrKey] = {
                    name: attributeNames[attrKey],
                    value: this._attributes.mutable[attrKey][prevKey],
                };
            }
            else {
                let singleKey = Object.keys(this._attributes.mutable[attrKey])[0];
                attributeList[attrKey] = {
                    name: attributeNames[attrKey],
                    value: this._attributes.mutable[attrKey][singleKey],
                };
            }
        }
        return attributeList;
    }

    onSelect() {
        if (this._lock || !this._active) return;
        this._selected = true;
        this.notify();
    }

    //TODO: unfinished and probably unnecessary modifications - selected property
    // is used for mergers.
    /*
    onSelectKeypoint(ind){
        if(this._lock || !(this._activeKeypoint == ind)) return;
        this._shape[ind]._selected

    } */

    visibleOnFrames(checkSet) {
        let trackSet = this.frameSet;
        let intersection = new Set( [...checkSet].filter(x => trackSet.has(x)) );
        if (intersection.size) return true;
        else return false;
    }

    fillMutableAttributes(attribData) {
        let newMutableAttributes = new Object();
        for (let singleAttrData of attribData) {
            let attrKey = singleAttrData[0];
            let attrInfo = this._labelsInfo.attrInfo(attrKey);
            if (!attrInfo.mutable) continue;
            let attrFrame = singleAttrData[1];
            if (+attrFrame < this._firstFrame) attrFrame = '' + this._firstFrame;
            /* This fix changes default attribute frame from start job frame to first track frame.
                * It need for correct merge work. */
            let attrValue = this._labelsInfo.strToValues(attrInfo.type, singleAttrData[2])[0];

            if ( !(attrKey in newMutableAttributes) ) {
                newMutableAttributes[attrKey] = new Object();
            }
            newMutableAttributes[attrKey][attrFrame] = attrValue;
            this._shape.recordPosition(this._shape.interpolatePosition(+attrFrame, this._firstFrame), +attrFrame);
        }

        let labelAttributes = this._labelsInfo.labelAttributes(this._label);
        for (let attrKey in labelAttributes) {
            if (!(attrKey in newMutableAttributes)) {
                let attrInfo = this._labelsInfo.attrInfo(attrKey);
                if (!attrInfo.mutable) continue;
                newMutableAttributes[attrKey] = new Object();
                newMutableAttributes[attrKey][this._firstFrame] = attrInfo.values[0];
            }
        }

        return newMutableAttributes;
    }

    fillImmutableAttributes(attribData) {
        let newImmutableAttributes = new Object();
        for (let singleAttrData of attribData) {
            let attrKey = singleAttrData[0];
            let attrInfo = this._labelsInfo.attrInfo(attrKey);
            if (attrInfo.mutable) continue;
            let attrValue = this._labelsInfo.strToValues(attrInfo.type, singleAttrData[2])[0];
            newImmutableAttributes[attrKey] = attrValue;
        }

        let labelAttributes = this._labelsInfo.labelAttributes(this._label);
        for (let attrKey in labelAttributes) {
            if (!(attrKey in newImmutableAttributes)) {
                let attrInfo = this._labelsInfo.attrInfo(attrKey);
                if (attrInfo.mutable) continue;
                newImmutableAttributes[attrKey] = attrInfo.values[0];
            }
        }

        return newImmutableAttributes;
    }


    static ShapeContain(pos, x, y, type) {
        if (type === 'box') {
            return Box.contain(x, y, pos);
        }
        else if (type === 'skel'){
            return Skeleton.contain(x,y,pos);
        }
        else throw new Error('Unknown shape type');
    }


    static ShapeArea(pos, type) {
        if (type === 'box') {
            return Box.area(pos);
        }
        else if (type === 'skel'){
            return Skeleton.area(pos);
        }
        else throw new Error('Unknown shape type');
    }


    static computeFrameCount(stopFrame, journal) {
        let counter = 0;
        let visibleFrame = null;
        let hiddenFrame = null;
        for (let frame in journal) {
            if (visibleFrame === null && !journal[frame]["outsided"]) {
                visibleFrame = +frame;
                continue;
            }
            if (visibleFrame != null && journal[frame]["outsided"]) {
                hiddenFrame = +frame;

                counter += hiddenFrame - visibleFrame;

                visibleFrame = null;
                hiddenFrame = null;
            }
        }
        if (visibleFrame != null) {
            counter += stopFrame - visibleFrame + 1;

        }
        return counter;
    }


    static computPrevNextFrames(curFrame, journal) {
        let prev = null;
        let next = null;

        for (let frame in journal) {
            if (+frame < curFrame) {
                prev = +frame;
            }
            if (+frame > curFrame) {
                next = +frame;
                break;
            }
        }
        return [prev, next];
    }

    //first "non-outsided" frame
    static computeFirstFrame(journal) {
        for (let frame in journal) {
            if (!journal[frame]["outsided"]) {
                return +frame;
            }
        }
    }


    static createShape(shapeType, data) {
        if (shapeType === 'box') {
            return new Box(data);
        }
        else if (shapeType === 'skel'){
            return new Skeleton(data);
        }
        else throw new Error('Unknown shape type');
    }
}


class Box {
    constructor(data) {
        this._positionJournal = new Object();


        Object.defineProperty(this._positionJournal, 'clone', {
            enumerable: false,
            value: function(key) {
                if (key in this) {
                    return {
                        xtl: this[key].xtl,
                        ytl: this[key].ytl,
                        xbr: this[key].xbr,
                        ybr: this[key].ybr,
                        outsided: this[key].outsided,
                        occluded: this[key].occluded
                    };
                }
                else throw new Error("Unknown key frame for positionJournal.clone()");
            }
        });

        for (let i = 0; i < data.length; i ++) {
            let frameNumber = data[i][4];
            let position = {
                xtl: data[i][0],
                ytl: data[i][1],
                xbr: data[i][2],
                ybr: data[i][3],
                outsided: data[i][5],
                occluded: data[i][6]
            };
            this._positionJournal[frameNumber] = position;
        }
    }


    setKeyFrame(value, frame, firstFrame) {
        let pJ = this._positionJournal;
        let firstFrameCandidates = Object.keys(pJ).length;
        let interpolated = this.interpolatePosition(frame, firstFrame);

        if (!value && firstFrameCandidates < 2) {
            return false;
        }

        if (value && !(frame in pJ)) {
            this.recordPosition(interpolated, frame);
            return true;
        }

        if (!value && frame in pJ) {
            delete pJ[frame];
            return true;
        }
    }


    recordPosition(pos, frame) {
        this._positionJournal[frame] = {
            xtl: pos.xtl,
            ytl: pos.ytl,
            xbr: pos.xbr,
            ybr: pos.ybr,
            outsided: pos.outsided,
            occluded: pos.occluded
        };
    }

    export() {
        let serialized = {};
        for (let frame in this._positionJournal) {
            let pos = this._positionJournal[frame];
            serialized[frame] = [pos.xtl, pos.ytl, pos.xbr, pos.ybr, pos.occluded, pos.outsided];
        }
        return serialized;
    }

    interpolatePosition(frameNumber, firstFrame) {

        let pJ = this._positionJournal;
        if (firstFrame == frameNumber) return Object.assign(pJ.clone(firstFrame), {keyFrame: true});
        let leftPos = NaN;
        let rightPos = NaN;
        //Loop over frame numbers and assign new (different)
        // (rightmost and leftmost?) framekeyss to leftPos and rightPos
        for (let frameKey in pJ) {
            if (+frameKey == frameNumber) return Object.assign(pJ.clone(frameKey), {keyFrame: true});
            if (+frameKey < frameNumber) leftPos = +frameKey;
            if (+frameKey > frameNumber) {
                rightPos = +frameKey;
                break;
            }
        }
        if (isNaN(leftPos)) {
            let position = pJ.clone(rightPos);
            position.outsided = true;
            return position;
        }
        if (isNaN(rightPos) || pJ[leftPos]["outsided"]) {
            return pJ.clone(leftPos);
        }

        let leftCurDifference = frameNumber - leftPos;
        let leftRightDifference = rightPos - leftPos;
        let relativeOffset = leftCurDifference / leftRightDifference;

        let interpolatedPos = {
            xtl: pJ[leftPos].xtl+ (pJ[rightPos].xtl - pJ[leftPos].xtl) * relativeOffset,
            ytl: pJ[leftPos].ytl + (pJ[rightPos].ytl - pJ[leftPos].ytl) * relativeOffset,
            xbr: pJ[leftPos].xbr + (pJ[rightPos].xbr - pJ[leftPos].xbr) * relativeOffset,
            ybr: pJ[leftPos].ybr + (pJ[rightPos].ybr - pJ[leftPos].ybr) * relativeOffset,
            outsided: false,
            occluded: pJ[leftPos].occluded
        };
        return interpolatedPos;
    }

    static contain(x,y,pos) {
        return (x >= pos.xtl && x <= pos.xbr && y >= pos.ytl && y <= pos.ybr);
    }

    static area(pos) {
        if (pos.outsided) return 0;
        else return ((pos.xbr - pos.xtl) * (pos.ybr - pos.ytl));
    }
}

class Skeleton {
    constructor(data) {

        this._positionJournal = new Object();

        Object.defineProperty(this._positionJournal, 'clone', {
            enumerable: false,
            value: function(key) {
                    if (key in this) {
                        return {
                            skel : this[key].skel,
                            outsided: this[key].outsided,
                            occluded: this[key].occluded
                        };
                }
                else throw new Error("Unknown key frame for positionJournal.clone()");
            }
        });

        for (let i = 0; i < data.length; i ++) {
            let frameNumber = data[i][1];

            this._positionJournal[frameNumber] = {
                skel: data[i][0], //contains x,y,name,visibility now
                outsided: data[i][2],
                occluded: data[i][3]
            };
        }
    }

    setKeyFrame(value, frame, firstFrame) {
        let pJ = this._positionJournal;
        let firstFrameCandidates = Object.keys(pJ).length;
        let interpolated = this.interpolatePosition(frame, firstFrame);

        if (!value && firstFrameCandidates < 2) {
            return false;
        }

        if (value && !(frame in pJ)) {
            this.recordPosition(interpolated, frame);
            return true;
        }

        if (!value && frame in pJ) {
            delete pJ[frame];
            return true;
        }
    }

    recordPosition(pos, frame) {
        this._positionJournal[frame]= {
            skel: pos.skel,
            outsided: pos.outsided,
            occluded: pos.occluded
        };
    }

    export() {
        let serialized = {};
        
        for (let frame in this._positionJournal) {
            let pos = this._positionJournal[frame];
            
           
            var tmp = {
                'skels' : [],
                'activity' : 'test_modif'
            };

            // Include "center" keypoint, we will save it in database too

            //TODO: un-mix up order of pos contents


            for (var i = 0; i < pos.skel.length;i++){
                tmp['skels'].push([pos.skel[i][0],   // x
                                   pos.skel[i][1],   // y
                                   +pos.skel[i][3],   // visibility
                                   pos.skel[i][2]]); //name
            }

            //TODO: need to decide when to assign activity and activity taxonomy

            //TODO: decide on other information concerning global skeletons.
            // There needs to be an "outsided" value for when the skeleton
            // disappears off screen so TrackedObject can inherit from it

            serialized[frame] = tmp;
        }
        return serialized;
    }

    interpolatePosition(frameNumber, firstFrame) {

        let pJ = this._positionJournal;
        if (firstFrame == frameNumber) return Object.assign(pJ.clone(firstFrame), {keyFrame: true});
        let leftPos = NaN;
        let rightPos = NaN;
        for (let frameKey in pJ) {
            if (+frameKey == frameNumber) return Object.assign(pJ.clone(frameKey), {keyFrame: true});
            if (+frameKey < frameNumber) leftPos = +frameKey;
            if (+frameKey > frameNumber) {
                rightPos = +frameKey;
                break;
            }
        }
        if (isNaN(leftPos)) {
            let position = pJ.clone(rightPos);
            position.outsided = true;
            return position;
        }
        if (isNaN(rightPos) || pJ[leftPos]["outsided"]) {
            return pJ.clone(leftPos);
        }

        let leftCurDifference = frameNumber - leftPos;
        let leftRightDifference = rightPos - leftPos;
        let relativeOffset = leftCurDifference / leftRightDifference;


        //TODO: Implement interpolation (if judged useful)
        // In this scenario, we are switching to a frame in between keyframes
        // (in my understanding, these are frames where a track has been edited).
        // The result for this frame should be the interpolated position between
        // key frame positions.
        // For now, we'll just retain leftPos.

        /*
        let leftCurDifference = frameNumber - leftPos;
        let leftRightDifference = rightPos - leftPos;
        let relativeOffset = leftCurDifference / leftRightDifference;
        let interpolatedPos = {
            xtl: pJ[leftPos].xtl+ (pJ[rightPos].xtl - pJ[leftPos].xtl) * relativeOffset,
            ytl: pJ[leftPos].ytl + (pJ[rightPos].ytl - pJ[leftPos].ytl) * relativeOffset,
            xbr: pJ[leftPos].xbr + (pJ[rightPos].xbr - pJ[leftPos].xbr) * relativeOffset,
            ybr: pJ[leftPos].ybr + (pJ[rightPos].ybr - pJ[leftPos].ybr) * relativeOffset,
        */


        //TODO: assumes "visibility" value remains constant for now...

        var interpolatedPosSkel = [];
        for (var i = 0; i < pJ[leftPos].skel.length; i++){

            let newx = (+pJ[leftPos].skel[i][0] + (+pJ[rightPos].skel[i][0] - +pJ[leftPos].skel[i][0]) * relativeOffset).toString();
            let newy = (+pJ[leftPos].skel[i][1] + (+pJ[rightPos].skel[i][1] - +pJ[leftPos].skel[i][1]) * relativeOffset).toString();
            interpolatedPosSkel[i] = [newx,
                                      newy,
                                      pJ[leftPos].skel[i][2],
                                      pJ[leftPos].skel[i][3]];
        }

        let interpolatedPos = {
            skel: interpolatedPosSkel,//pJ[leftPos].skel,
            outsided: 0,
            occluded: pJ[leftPos].occluded
        };

        return interpolatedPos;
    }

    static contain(x,y,pos) {

        var shapesX = [];
        var shapesY = [];

        for (var i = 0; i < pos.skel.length; i++){
                shapesX.push(pos.skel[i][0]);
                shapesY.push(pos.skel[i][1]);
            }

            let xtl = Math.min(...shapesX); // xtl of bbox fitting skeleton joints
            let ytl = Math.min(...shapesY); // ytl of fitting bbox
            let xbr = Math.max(...shapesX);
            let ybr = Math.max(...shapesY);
        return (x >= xtl && x <= xbr && y >= ytl && y <= ybr);
    }

    static area(pos) {
        if (pos.outsided) return 0;
        else{

            var shapesX = [];
            var shapesY = [];
            for (var i = 0; i < pos.skel.length; i++){
                shapesX.push(pos.skel[i][0]);
                shapesY.push(pos.skel[i][1]);
            }

            let xtl = Math.min(...shapesX); // xtl of bbox fitting skeleton joints
            let ytl = Math.min(...shapesY); // ytl of fitting bbox
            let xbr = Math.max(...shapesX);
            let ybr = Math.max(...shapesY);

            return ((xbr - xtl) * (ybr - ytl));

        }
    }
}
