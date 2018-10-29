/* exported TrackView */
"use strict";

class TrackView {
    constructor(trackController, trackModel, interpolation, labelsInfo, colors) {
        this._trackController = trackController;
        this._framecontent = $('#frameContent');
        this._uicontent = $('#uiContent');
        this._revscale = 1;

        this._shape = TrackView.makeShape(interpolation.position, trackModel.shapeType, colors,
                                            trackModel.id);
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

        let kp = this._keypoint_names;

        this._connections = [[kp[1-1],kp[2-1]],
                            [kp[1-1],kp[3-1]],
                            [kp[2-1],kp[3-1]],
                            [kp[2-1],kp[4-1]],
                            [kp[3-1],kp[5-1]],
                            [kp[6-1],kp[4-1]],
                            [kp[7-1],kp[5-1]],
                            [kp[8-1],kp[2-1]],
                            [kp[9-1],kp[3-1]],
                            [kp[10-1],kp[8-1]],
                            [kp[11-1],kp[9-1]],
                            [kp[12-1],kp[10-1]],
                            [kp[13-1],kp[11-1]]];
        this._connections_length = this._connections.length;


        this._connectors = TrackView.makeConnections(this._shape,this._connections,
                                                     this._keypoint_names, trackModel.id,colors);
        // this returns an HTML text box object
        // TODO: return individual text box objects for individual keypoints
        this._text = TrackView.makeText(interpolation, labelsInfo.labels()[trackModel.label],
                                        trackModel.id,colors);

        this._keypoint_texts = TrackView.makeKeypointTexts(interpolation,colors);

        this._ui = TrackView.makeUI(interpolation, labelsInfo, colors, trackModel,
                                    this._shape, this._connectors, this._keypoint_texts,
                                    trackController, this._revscale);
        this._ui.appendTo(this._uicontent);

        // If box, _shape corresponds to a html element, if skel, corresponds to a list

        this._text.appendTo(this._framecontent);


        if (trackModel.shapeType == 'skel'){
            for (var i = 0; i < this._shape.length; i++){
                this._shape[i].appendTo(this._framecontent);
            }

            for (var i = 0; i < this._connectors.length; i++){
                this._connectors[i].appendTo(this._framecontent);
            }
        } else {
            this._shape.appendTo(this._framecontent);
        }
        for(var i =0; i < this._keypoint_texts.length; i++){
            $(this._keypoint_texts[i]).appendTo(this._framecontent);
        }

        this._outsideShape = null;

        this._shape.forEach((keypoint,ind) => {

            keypoint.on('drag', function(event, scale) {

            $("[activeKeypointText]").remove();

            //TODO: logger.
            /*let type = event.type === 'drag' ? Logger.EventType.dragObject;
            let modifyObjEvent = Logger.addContinuedEvent('drag');*/
            this._revscale = 1 / scale;

            this.updateViewGeometry();
            this._trackController.onchangekeypointgeometry(this._shape);
            /*modifyObjEvent.close();*/
        }.bind(this))

        })

        /*
        this._shape.on('resize drag', function(event, scale) {
            let type = event.type === 'drag' ? Logger.EventType.dragObject : Logger.EventType.resizeObject;
            let modifyObjEvent = Logger.addContinuedEvent(type);
            this._revscale = 1 / scale;
            this.updateViewGeometry();
            this._trackController.onchangegeometry(this._shape);
            modifyObjEvent.close();
        }.bind(this));
        this._shape.on('mousedown', function() {
            this._trackController.onclick();
            this._uicontent.scrollTop(0);
            this._uicontent.scrollTop(this._ui.offset().top - 10);
        }.bind(this));

        /*
        for(var i = 0; i < this._shape.length; i++){

            this._shape[i].on('mousedown', function() {
                this._trackController.onclickkeypoint(i);
            }.bind(this));
        }*/

        this._ui.on('mouseover', (e) => this.onoverUI(trackModel.id, e));
        this._ui.on('mouseout', (e) => this.onoutUI(e));
        this._ui.onchangelabel = (trackModel, newLabelId) => this.onchangelabel(trackModel, newLabelId);
        this._ui.onshift = function(frame) {
            this.onshift(frame);
        }.bind(this);

        this._layout = [[0,-15], //nose
                      [-3,-10], //left shoulder
                      [3,-10], //right shoulder
                      [-4,-3], //left elbow
                      [4,-3], //right elbow
                      [-3.5,0], //left wrist
                      [3.5,0], //right wrist
                      [-2,2], //left hip
                      [2,2], //right hip
                      [-3,6], //left knee
                      [3,6], //right knee
                      [-3.5,10], //left ankle
                      [3.5,10], //right ankle
                      [0,-3]];  // center (will be displayed in different color)

        trackModel.subscribe(this);
    }

    _drawOutsideShape() {
        let size = {
            x: 0,
            y: 0,
            width: 10000,
            height: 10000
        };

        let defs = $(this._framecontent.find('defs')[0] || document.createElementNS('http://www.w3.org/2000/svg', 'defs'))
            .prependTo(this._framecontent).append();

        let mask = $(document.createElementNS('http://www.w3.org/2000/svg', 'mask'))
            .attr(Object.assign({}, size, {id: 'outsideMask'})).appendTo(defs);

        $(document.createElementNS('http://www.w3.org/2000/svg', 'rect'))   // exclude from mask
            .attr(Object.assign({}, size, {fill: '#555'})).appendTo(mask);

        $(document.createElementNS('http://www.w3.org/2000/svg', 'rect')).attr({    // include to mask
            x: this._shape.attr('x'),
            y: this._shape.attr('y'),
            height: this._shape.attr('height'),
            width: this._shape.attr('width'),
            fill: 'black',
        }).appendTo(mask);

        $(document.createElementNS('http://www.w3.org/2000/svg', 'rect'))
            .attr(Object.assign(size, {mask: 'url(#outsideMask)'}))
            .addClass('outsideRect')
            .appendTo(this._framecontent);
    }

    _removeOutsideShape() {
        this._framecontent.find('defs').remove();
        this._framecontent.find('rect.outsideRect').remove();

    }

    centroid(pos){

        let frameWidth = +$('#frameContent').css('width').slice(0,-2);
        let frameHeight = +$('#frameContent').css('height').slice(0,-2);

        var shapesX = [];
        var shapesY = [];

        for (var i = 0; i < pos.skel.length; i++) {
            shapesX.push(pos.skel[i][0]);
            shapesY.push(pos.skel[i][1]);
        }

        let xtl = Math.max(0,Math.min(...shapesX)); // xtl of bbox fitting skeleton joints
        let ytl = Math.max(0,Math.min(...shapesY)); // ytl of fitting bbox
        let xbr = Math.min(frameWidth,Math.max(...shapesX));
        let ybr = Math.min(frameHeight,Math.max(...shapesY));
        return [(xbr + xtl) / 2,  (ybr + ytl) / 2, 'center',"2"]; };

    changeOccludedHandler(e){

        var keyCode = e.keyCode || e.which;

        if( this._trackController._trackModel._activeKeypoint != null){
             // 83 = s.
              if (keyCode == 83 && this._trackController._trackModel._activeKeypoint != (this._keypoint_names.length -1) ){
                  var vis = $(this._shape[this._trackController._trackModel._activeKeypoint]).attr('visibility');
                  this._shape[this._trackController._trackModel._activeKeypoint].updateVisibility(((vis == "2") ?  "1" : "2"));
                  this._trackController.onchangekeypointgeometry(this._shape);
              }
              }
    };


    onTrackUpdate(state) {

        this._removeOutsideShape();

        if (state.removed) {
            this.removeView();
            $("[activeKeypointText]").remove();
            return;
        }

        if (state.model.outside || state.model.hidden) {

            // Detach shape, connector, keypoint texts
            for (var i = 0; i < this._shape.length; i++) {
                this._shape[i].detach();
            }
            for (var i = 0; i < this._connectors.length; i++) {
                this._connectors[i].detach();
            }
            for (var i = 0; i < this._keypoint_texts.length; i++) {
                $(this._keypoint_texts[i]).detach();
            }
        }

        else {

            if (state.model._shapeType == 'skel') {

                // Insert connectors
                for (var conn = 0; conn < this._connectors.length; conn++) {

                    // For each connection
                    var keyp1, keyp2 = null;
                    for (var i = 0; i < this._shape.length; i++) {
                        if ($(this._shape[i]).attr('name') == (this._connections[conn][0])) {
                            keyp1 = this._shape[i];
                        }
                        else if ($(this._shape[i]).attr('name') == (this._connections[conn][1])) {
                            keyp2 = this._shape[i];
                        };
                    }
                    this._connectors[conn].updatePos({
                        'x1': $(keyp1).attr('cx'),
                        'y1': $(keyp1).attr('cy'),
                        'x2': $(keyp2).attr('cx'),
                        'y2': $(keyp2).attr('cy'),
                        'id1': $(keyp1).attr('name'),
                        'id2': $(keyp2).attr('name')
                    })
                    this._framecontent.append(this._connectors[conn]);
                }

                // Insert keypoint texts
                for (var i = 0; i < this._keypoint_texts.length; i++) {
                    this._framecontent.append($(this._keypoint_texts[i]));
                }

                // Insert circles
                let centr = this.centroid(state.position);
                for (var i = 0; i < state.position.skel.length; i++) {

                    if ($(this._shape[i]).attr('name') == 'center'){
                        state.position.skel[i] = centr;
                    }
                    this._shape[i].updatePos(state.position.skel[i]);
                    this._framecontent.append(this._shape[i]);

                }
            } else {
                this._shape.updatePos(state.position);
                this._framecontent.append(this._shape);
            }
        }


        //TODO: try to focus on basic functionality before UI
        //this.updateColors(state.model.colors, state.model.merge);

        /*
        this._ui.lock(state.lock);
        if (state.lock) {
            this._shape.addClass('lockedShape');
            this._shape.removeClass('highlightedShape');
            this._shape.removeClass('changeable');

            this._text.addClass('lockedText');
            this._ui.removeClass('highlightedUI');
        }
        else {
            this._shape.removeClass('lockedShape');
            this._text.removeClass('lockedText');
        }
        */
        if (!(state.model.hiddenLabel || state.model.outside || state.model.hidden)) {
            this.updateAndViewText(state);
            this._text.appendTo(this._framecontent);
        }
        else {
            this._text.detach();
        }

        if (state.model._activeKeypoint != null && !(state.lock || state.model.outside || state.model.hidden)){

            // Introduce keypoint labels before keypoint to avoid issues
            // with hovering over keypoint.

            $("[activeKeypointText]").remove();

            let svgText = document.createElementNS('http://www.w3.org/2000/svg', 'text');

            svgText.setAttribute('x', $(this._shape[state.model._activeKeypoint]).attr('cx'));
            svgText.setAttribute('y',
                +$(this._shape[state.model._activeKeypoint]).attr('cy') + $(this._shape[state.model._activeKeypoint]).attr('r') + 3);
            svgText.setAttribute('class', 'shapeText regular');

            let labelNameText = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');

            // Defines text
            labelNameText.innerHTML = `${$(this._shape[state.model._activeKeypoint]).attr('name')}`;
            //
            labelNameText.setAttribute('dy', '1em');
            labelNameText.setAttribute('x', $(this._shape[state.model._activeKeypoint]).attr('cx'));
            labelNameText.setAttribute('class', 'bold');
            labelNameText.setAttribute('activeKeypointText',true);
            svgText.appendChild(labelNameText);
            $(svgText).appendTo(this._framecontent);

            this._shape[state.model._activeKeypoint].addClass('highlightedShape');
            if (this._framecontent.has(this._shape)) {
                this._shape[state.model._activeKeypoint].appendTo(this._framecontent);
            }

            Mousetrap.bind('s', this.changeOccludedHandler.bind(this), 'keydown');

        } else{
            //We will have resetted ._activeKeypoint to null by now.
            //Just loop through all keypoints and remove class 'highlightedShape'
            // if exists.
            this._shape.forEach((keypoint) => {
                keypoint.removeClass('highlightedShape');
            });
            $("[activeKeypointText]").remove();
        }

        /*
        if (state.active && !(state.lock || state.model.outside || state.model.hidden)) {
            this._shape.addClass('highlightedShape');
            if (this._framecontent.has(this._shape)) {
                this._shape.appendTo(this._framecontent);
            }
            this._ui.addClass('highlightedUI');
            this._framecontent.append(this._text);
            this.updateAndViewText(state);
        }
        else if (state.active) {
            this._ui.addClass('highlightedUI');
        }
        else {
            this._shape.removeClass('highlightedShape');
            this._ui.removeClass('highlightedUI');
        }

        if (state.model.activeAAMTrack) {
            if (state.active) {
                this._ui.updateAttributes(state.attributes);
            }
            this._drawOutsideShape();
            this._shape.css('fill-opacity', '0');
            this._uicontent.scrollTop(0);
            this._uicontent.scrollTop(this._ui.offset().top - 10);
        }
        else {
            this._shape.css('fill-opacity', '');
        }

        if (state.merge) {
            this._shape.addClass('mergeHighlighted');
        }
        else {
            this._shape.removeClass('mergeHighlighted');
        }

        //TODO: as soon as track is updated, keyFrame
        // property becomes true.

        let occluded = state.model.occluded;
        */
        let keyFrame = state.position.keyFrame === true;

        this._ui.keyFrame(keyFrame);

        let outsided = state.position.outsided;
        /*
        this._ui.occluded(occluded);
        */
        this._ui.outsided(outsided);
        /*
        if (occluded) {R
            this._shape.addClass('occludedShape');
        }
        else {
            this._shape.removeClass('occludedShape');
        }
        */

    }

    removeView() {

        if (this._trackController._trackModel._shapeType == 'skel'){
            for (var i =0; i < this._layout.length; i++){
               this._shape[i].remove();
            }
            for (var i =0; i < this._connections_length; i++){
               this._connectors[i].remove();
            }
            for (var i =0; i < this._keypoint_texts.length; i++) {
                this._keypoint_texts[i].remove();
            }
        }
        else{
            this._shape.remove();
        }
        this._ui.remove();
        this._text.remove();

    }

    updateColors(colors, merge) {
        if (merge) this._shape.css('fill','');
        else this._shape.css('fill', colors.background);

        this._shape.css('stroke', colors.border);
        this._ui.css('background-color', colors.background);
    }

    //TODO: this function needs to be revised

    updateViewGeometry() {
        let revscale = this._revscale;
        let frameWidth = +$('#frameContent').css('width').slice(0,-2);
        let frameHeight = +$('#frameContent').css('height').slice(0,-2);

        var shape = null;

        for(var i = 0; i < this._shape.length; i++) {
            if (this._shape[i][0].attributes["name"].value == "center") {
                shape = this._shape[i];
            }
        }
            let oldcx = +shape.attr('cx');
            let oldcy = +shape.attr('cy');

            if (oldcx < 0) oldcx = 0;
            if (oldcy < 0) oldcy = 0;
            if (oldcx > frameWidth) oldcx = frameWidth;
            if (oldcy > frameHeight) oldcy = frameHeight;

            shape.attr({
                cx: oldcx,
                cy: oldcy,
            });

            //text transformation
            let xmargin = -12;
            let ymargin = 5;

            let cxpos = +shape.attr('cx') + xmargin;
            let cypos = +shape.attr('cy') + ymargin;

            this._text.attr({
            x : cxpos / revscale,
            y : cypos / revscale,
            transform: `scale(${revscale})`});

        //tspan is the div with the text box. Setting its x to parent's (_text's) x.

        this._text.find('tspan').each(function() {
            let parent = $(this.parentElement);
            this.setAttribute('x', parent.attr('x'));
        });

            //keypoint text transformation

        let xkeypointmargin = -1.5;
        let ykeypointmargin = 2;


        for(var i =0; i < this._keypoint_texts.length; i++){

            let cxpos = +$(this._shape[i]).attr('cx') + xkeypointmargin;
            let cypos = +$(this._shape[i]).attr('cy') + ykeypointmargin;

            //TODO: assuming keypoint_texts ordered in same way as _shape
            // possible source of error?

            $(this._keypoint_texts[i]).attr({
                x : cxpos / revscale,
                y : cypos / revscale,
                transform: `scale(${revscale})`});

            if(['l','r'].includes($(this._shape[i]).attr('name')[0])){
                $(this._keypoint_texts[i]).text($(this._shape[i]).attr('name')[0].toUpperCase());
            }

            $(this._keypoint_texts[i]).find('tspan').each(function() {
                let parent = $(this.parentElement);
                this.setAttribute('x', parent.attr('x'));
            });

        }

        //shape.css('stroke-width', 2 * revscale);

        /*
        let oldX1 = +this._shape.attr('x');
        let oldY1 = +this._shape.attr('y');
        let oldX2 = +this._shape.attr('x') + +this._shape.attr('width');
        let oldY2 = +this._shape.attr('y') + +this._shape.attr('height');

        if (oldX1 < 0) oldX1 = 0;
        if (oldY1 < 0) oldY1 = 0;
        if (oldX2 > frameWidth) oldX2 = frameWidth;
        if (oldY2 > frameHeight) oldY2 = frameHeight;

        let width = oldX2 - oldX1;
        if (width < MIN_BOX_SIZE) {
            width = MIN_BOX_SIZE;
            if (oldX1 + width > frameWidth) {
                oldX1 = oldX2 - width;
            }
        }

        let height = oldY2 - oldY1;
        if (height < MIN_BOX_SIZE) {
            height = MIN_BOX_SIZE;
            if (oldY1 + height > frameHeight) {
                oldY1 = oldY2 - height;
            }
        }

        this._shape.attr({
            x: oldX1,
            y: oldY1,
            width: width,
            height: height
        })

        let margin = 5;
        let box = null;
        try {       // mozilla firefox throws exception when call getBBox() for undrawed object. Chrome in this case return zero box.
            box = this._text['0'].getBBox();
        }
        catch(err) {
            box = {
                x: 0,
                y: 0,
                width: 0,
                height: 0
            };
        }
        */
        //TODO: not sure how what transformations we will need to do
        // for keypoints - let's figure that out later

        /*
        let xpos = +this._shape.attr('x') + +this._shape.attr('width') + margin;
        let ypos = +this._shape.attr('y');

        if (xpos + box.width * revscale > frameWidth) {
            xpos = +this._shape.attr('x') - margin - box.width * revscale;
            if (xpos < 0) {
                xpos = +this._shape.attr('x') + margin;
            }
        }
        if (ypos + box.height * revscale > frameHeight) {
            let greatherVal = ypos + box.height * revscale - frameHeight;
            ypos = Math.max(0, ypos - greatherVal);
        }
        this._text.attr({
            x: xpos / revscale,
            y: ypos / revscale,
            transform: `scale(${revscale})`
        });
        this._text.find('tspan').each(function() {
            let parent = $(this.parentElement);
            this.setAttribute('x', parent.attr('x'));
        });
        this._text.attr({
            cx : cxpos / revscale,
            cy : cypos / revscale,
            transform: `scale(${revscale})`
        })
        //TODO: not sure what this does
        this._text.find('tspan').each(function() {
            let parent = $(this.parentElement);
            this.setAttribute('cx', parent.attr('cx'));
        });

        this._shape.css('stroke-width', 2 * revscale);
        */
    }

    updateAndViewText(state) {
        let attributes = state.attributes;
        let activeAttribute = state.model.activeAttribute;
        let header = this._text.children().first();
        header.detach();
        this._text.empty();
        header.appendTo(this._text);

        let x = +this._text.attr('x');
        for (let attrKey in attributes) {
            let attribute = attributes[attrKey];
            let value = attribute.value;
            if (value === AAMUndefinedKeyword) value = "";
            let attrElem = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
            attrElem.setAttribute('dy', '1em');
            attrElem.setAttribute('x', x);

            // This displays the text displayed when highlighted
            attrElem.innerHTML = `${attribute.name.normalize()}: ${value}`;

            if (+attrKey === activeAttribute) {
                attrElem.style['fill'] = 'red';
                attrElem.style['font-weight'] = 'bold';
            }
            this._text['0'].appendChild(attrElem);
        }
        this.updateViewGeometry();
    }

    set revscale(value) {
        this._revscale = value;
    }

    static makeUI(interpolation, labelsInfo, colors, trackModel, shape,
                  connectors,_keypoint_texts, trackController,revScale) {

        let attributes = interpolation.attributes;
        let labelId = trackModel.label;
        let id = trackModel.id;
        let trackType = trackModel.trackType;
        let shapeType = trackModel.shapeType;
        let labels = labelsInfo.labels();
        let labelName = labels[labelId].normalize();
        let shortkeys = userConfig.shortkeys;

        let ui = $('<div></div>').css('background-color', colors.background).addClass('uiElement regular');
        $(`<label> Worker ${id} </label>`).addClass('semiBold').appendTo(ui);
        let button = $('<a></a>').addClass('close').appendTo(ui);
        button.attr('title', `Delete Object`); //(${shortkeys["delete_track"].view_value})

        // TODO: implement remove functionality.

        button.on('click', function(event) {trackModel.remove(event.shiftKey);});
        /*if (!(interpolation.position.hasOwnProperty('skel'))){
            button.on('click', function(event) {
                                trackModel.remove(event.shiftKey);
                                });}*/
        let keypoints = ["nose",
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

        let occludedState = trackModel.occluded;
        let lockedState = trackModel.lock;
        let outsidedState = trackModel.outside;
        let keyFrameState = interpolation.position.keyFrame === true;    // exclude 'undefined'

        let propManagement = $('<div></div>').appendTo(ui).css({
            'margin': '5px 10px'
        });

        //let lockShortkeys = `(${shortkeys["switch_lock_property"].view_value}), (${shortkeys["switch_all_lock_property"].view_value})`;
        //let occludedShortkey = `(${shortkeys["switch_occluded_property"].view_value})`;
/*
        let lockButton = $(`<button title="Lock Property ${lockShortkeys}"></button>`)
            .addClass('graphicButton lockButton').appendTo(propManagement);
        let occludedButton = $(`<button title="Occluded Property ${occludedShortkey}"></button>`)
            .addClass('graphicButton occludedButton').appendTo(propManagement); */
        let outsidedButton = $(`<button title="Outsided Property"></button>`).addClass('graphicButton outsidedButton');
        let keyFrameButton = $(`<button title="KeyFrame Property"></button>`).addClass('graphicButton keyFrameButton');
        //let flipButton = $(`<button title="Flip L/R"></button>`).addClass('graphicButton flipButton');



        if (trackModel.trackType == 'interpolation') {
            outsidedButton.appendTo(propManagement);
            keyFrameButton.appendTo(propManagement);
            //flipButton.appendTo(propManagement);
        }

        //Code for activity selector

        /*
        <select id="trackTypeSelect" class="regular h2">
            <option value="interpolation" class="regular"> Interpolation </option>
        </select>*/

        let labelsBlock = null;
        let attrBlocks = [];
        let buttonBlock = null;
        let hidden = interpolation.position.outsided;

        ui.extend({
            /*
            lock : function(value) {
                if (value) lockButton.addClass('locked');
                else lockButton.removeClass('locked');
                occludedButton.attr('disabled', value);
                outsidedButton.attr('disabled', value);
                keyFrameButton.attr('disabled', value);
                $(this).find('input, select').attr('disabled', value);
                lockedState = value;
            },

            occluded : function(value) {
                if (value) occludedButton.addClass('occluded');
                else occludedButton.removeClass('occluded');
                occludedState = value;
            },*/

            outsided : function(value) {
                if (value) outsidedButton.addClass('outsided');
                else outsidedButton.removeClass('outsided');
                outsidedState = value;
                this.hidden(value);
            },

            keyFrame: function(value) {
                if (value) keyFrameButton.addClass('keyFrame');
                else keyFrameButton.removeClass('keyFrame');
                keyFrameState = value;
            },

            hidden : function(value) {
                if (value && (value != hidden)) {
                    hidden = value;
                    if (labelsBlock) labelsBlock.detach();
                    for (let attrBlock of attrBlocks) {
                        attrBlock.detach();
                    }
                }
                else if (!value && (value != hidden)) {
                    hidden = value;
                    if (buttonBlock) buttonBlock.detach();
                    if (labelsBlock) labelsBlock.appendTo(ui);
                    for (let attrBlock of attrBlocks) {
                        attrBlock.appendTo(ui);
                    }
                    if (buttonBlock) buttonBlock.appendTo(ui);
                }
            },

            updateAttributes : function(attributes) {
                for (let attrKey in attributes) {
                    let attrInfo = labelsInfo.attrInfo(attrKey);
                    let name = attributes[attrKey].name;
                    let value = attributes[attrKey].value;
                    if (hidden) return;

                    switch (attrInfo.type) {
                    case 'text': {
                        let text = ui.find(`#${id}_${name}_text`)[0];
                        text.value = value;
                        break;
                    }
                    case 'number': {
                        let number = ui.find(`#${id}_${name}_number`)[0];
                        number.value = value;
                        break;
                    }
                    case 'checkbox': {
                        let checkbox = ui.find(`#${id}_${name}_checkbox`)[0];
                        checkbox.checked = labelsInfo.strToValues(attrInfo.type, value)[0] ? true : false;
                        break;
                    }
                    case 'select': {
                        let select = ui.find(`#${id}_${name}_select`)[0];
                        if (value === AAMUndefinedKeyword) value = "";
                        select.value = value;
                        break;
                    }
                    case 'radio':
                        ui.find(`#${id}_${name}_${value.toJSId()}_radio`)[0].checked = true;
                        break;
                    }
                }
            }
        });
        /*
        ui.lock(lockedState);
        ui.occluded(occludedState); */

        ui.outsided(outsidedState);
        ui.keyFrame(keyFrameState);

        /*
        lockButton.on('click', function() {
            lockedState = !lockedState;
            trackModel.lock = lockedState;
        });
        occludedButton.on('click', function() {
            occludedState = !occludedState;
            trackModel.occluded = occludedState;
        }); */

        outsidedButton.on('click', function() {
            //TODO: restore functionality of outsided Button
            trackModel.outside = !outsidedState;
        });

        /*
        flipButton.on('click', function() {

            // First, access all different body parts.

            let keyp_names = trackModel._keypoint_names;

            var bodyparts = [];


            for(let keyp_name in keyp_names){
                if(keyp_names[keyp_name].includes('left') || keyp_names[keyp_name].includes('right') && (!bodyparts.includes(keyp_names[keyp_name].split(" ")[1]))) {
                    bodyparts.push(keyp_names[keyp_name].split(" ")[1]);
                }
            }
            //Next, iterate over body parts and switch coordinates
            //if are "left" or "right"

            for (var c=0; c <connectors.length; c++){

                if ($(connectors[c]).attr('id1').includes('left')) {
                    $(connectors[c]).attr('id1', 'right ' + $(connectors[c]).attr('id1').split(" ")[1]);
                } else if ($(connectors[c]).attr('id1').includes('right')) {
                    $(connectors[c]).attr('id1', 'left ' + $(connectors[c]).attr('id1').split(" ")[1]);
                };

                if ($(connectors[c]).attr('id2').includes('left')) {
                    $(connectors[c]).attr('id2', 'right ' + $(connectors[c]).attr('id2').split(" ")[1]);
                } else if ($(connectors[c]).attr('id2').includes('right')) {
                    $(connectors[c]).attr('id2', 'left ' + $(connectors[c]).attr('id2').split(" ")[1]);
                };
            };

            for(var bodypart =0; bodypart < bodyparts.length; bodypart++) {
                //Switch circle left/right coordinates

                //Extremely inefficient, but given the nature of shape
                // I am not sure how to proceed otherwise

                var switches = {
                    left : null,
                    right : null
                };

                for(var c = 0; c < shape.length; c++){

                    // If name is right something or left something
                    if (bodyparts[bodypart] == $(shape[c]).attr('name').split(" ")[1]){
                        if ($(shape[c]).attr('name').split(" ")[0] == 'left'){
                            switches.left = c;
                        }
                        else {
                            switches.right = c;
                        }
                    }
                    else {
                        //Don't switch anything around, this is either nose
                        // or center keypoints.
                    }
                }
                var tmp_coord = [$(shape[switches.left]).attr('cx'),
                                 $(shape[switches.left]).attr('cy')];

                $(shape[switches.left]).attr({
                    'cx' : $(shape[switches.right]).attr('cx'),
                    'cy' : $(shape[switches.right]).attr('cy')
                });
                $(shape[switches.right]).attr({
                    'cx' : tmp_coord[0],
                    'cy' : tmp_coord[1]
                });
            }

            for(var kt = 0; kt< _keypoint_texts.length; kt++){

                if($(_keypoint_texts[kt]).text() =='L'){
                    $(_keypoint_texts[kt]).text('R');

                } else if ($(_keypoint_texts[kt]).text() =='R'){
                    $(_keypoint_texts[kt]).text('L');
                }
            }
            trackController.onchangekeypointgeometry(shape);
        }); */

        /*
        keyFrameButton.on('click', function() {
            trackModel.keyFrame = !keyFrameState;
        }); */
        let keypointsListButton = $(`<button title="Show/hide keypoints"></button>`)
            .addClass('graphicButton dropdownList dropButton').appendTo(propManagement);

        keypointsListButton.on('click', function() {
            skelKeypoints[0].classList.toggle('open');
            if ($(this).hasClass('rotated')){
                $(this).removeClass('rotated');
                $(this).css('transform','rotate(0deg)');
            } else {
                $(this).addClass('rotated');
                $(this).css('transform','rotate(90deg)');
            }

        });

        if (Object.keys(labels).length > 1) {
            let div = $('<div> </div>').css('width', '100%');
            $('<label> Label  </label>').addClass('semiBold').appendTo(div);
            let select = $('<select> </select>').addClass('uiSelect regular').appendTo(div);
            select.attr('title',
                `Change Object Label]`);
                //`Change Object Label [${shortkeys["change_track_label"].view_value}]`);

            for (let labelId in labels) {
                $(`<option value=${labelId}> ${labels[labelId]} </option>`).appendTo(select);
            }
            select.prop('value', labelId);
            select.on('change', function(event) {
                let labelId = +event.target.value;
                ui.onchangelabel(trackModel, labelId);
            });
            select.keydown(function(e) {
                e.preventDefault();
            });

            labelsBlock = div;
        }

        if (Object.keys(attributes).length) {
            //attrBlocks.push($('<label> <br>  </label>').addClass('semiBold'));
        }

        for (let attrKey in attributes) {
            let attribute = attributes[attrKey];
            let attrInfo = labelsInfo.attrInfo(attrKey);
            let name = attrInfo.name;
            let type = attrInfo.type;
            let values = attrInfo.values;
            let curValue = attribute.value;
            let attrView = TrackView.makeAttr(type, name, curValue, values, attrKey, id);
            attrView.addClass('attribute');
            attrView['0'].onchangeattribute = function(key, value) {
                trackModel.recordAttribute(key, value);
            };

            buttonBlock = null;//$('<div></div>').addClass('center');
            let prevKeyFrame = $('<button> \u2190 </button>');
            let nextKeyFrame = $('<button> \u2192 </button>');
            let initFrame = $('<button> \u21ba </button>');

            prevKeyFrame.attr('title',
                `Previous Key Frame (${shortkeys["prev_key_frame"].view_value})`);
            nextKeyFrame.attr('title',
                `Next Key Frame (${shortkeys["next_key_frame"].view_value})`);
            initFrame.attr('title', "First Visible Frame");

            //TODO: assumption there will only be one Attribute (worker role/posture)
            attrView.append(prevKeyFrame);
            attrView.append(initFrame);
            attrView.append(nextKeyFrame);

            prevKeyFrame.on('click', function() {
                let frame = trackModel.prevKeyFrame;
                if (frame != null) ui.onshift(frame);
            });

            nextKeyFrame.on('click', function() {
                let frame = trackModel.nextKeyFrame;
                if (frame != null) ui.onshift(frame);
            });

            initFrame.on('click', function() {
                let frame = trackModel.firstFrame;
                if (Number.isInteger(frame)) {
                    ui.onshift(frame);
                }
            });

            attrBlocks.push(attrView);
        }

        if (trackModel.trackType == 'interpolation') {
            /*
            buttonBlock = $('<div></div>').addClass('center');
            let prevKeyFrame = $('<button> \u2190 </button>');
            let nextKeyFrame = $('<button> \u2192 </button>');
            let initFrame = $('<button> \u21ba </button>');

            prevKeyFrame.attr('title',
                `Previous Key Frame (${shortkeys["prev_key_frame"].view_value})`);
            nextKeyFrame.attr('title',
                `Next Key Frame (${shortkeys["next_key_frame"].view_value})`);
            initFrame.attr('title', "First Visible Frame");

            //TODO: assumption there will only be one Attribute (worker role/posture)
            buttonBlock.append(prevKeyFrame);
            buttonBlock.append(initFrame);
            buttonBlock.append(nextKeyFrame); */
            ui.append(buttonBlock);

        }

        if (!hidden) {
            if (labelsBlock != null) ui.append(labelsBlock);
            for (let attrBlock of attrBlocks) {
                ui.append(attrBlock);
            }
        }

        if (buttonBlock != null) {
            ui.append(buttonBlock);
        }

        let skelKeypoints = $('<div id="skelKeypoints" class ="slider"></div>').appendTo(ui).css({
            'margin': '5px 10px',
            'overflow': 'hidden'
        });

        let occludedStates = [];
        let occludedButtons = [];
        //let occludedShortkeys = [];

        // Need to enforce interpolation.position.skel has the same order as keypoints.
        // When info saved to database, skel keypoint order isn't necessarily preserved.
        function comparator(a, b) {
            if (keypoints.indexOf(a[2]) < keypoints.indexOf(b[2])) return -1;
            if (keypoints.indexOf(b[2]) < keypoints.indexOf(a[2])) return 1;
            return 0;
        }

        interpolation.position.skel = interpolation.position.skel.sort(comparator);

        //don't include center
        for (let i_keypoint = 0; i_keypoint < keypoints.length -1; i_keypoint++) {

            occludedStates[i_keypoint] = interpolation.position.skel[i_keypoint][3]; // (should be "2" if// new)
            //occludedShortkeys[i_keypoint] = `(${shortkeys["switch_occluded_property"].view_value})`;

            $(`<label> <br> ${keypoints[i_keypoint]} </label>`).addClass('semiBold').appendTo(skelKeypoints); //(this._skelKeypoints);

            occludedButtons[i_keypoint] = $(`<button title="Occluded Property"></button>`)
                .addClass('graphicButton occludedButton'); //.appendTo(this._skelKeypoints);

            occludedButtons[i_keypoint].on('mouseover', function() {
                 shape[i_keypoint].addClass('highlightedShape');
                 $(shape[i_keypoint]).attr({
                     r : 3*$(shape[i_keypoint]).attr('r'),
                     });
            })

            occludedButtons[i_keypoint].on('mouseout', function() {
                 shape[i_keypoint].addClass('highlightedShape');
                 $(shape[i_keypoint]).attr({
                     r : $(shape[i_keypoint]).attr('r')/3,
                     });
            })

            occludedButtons[i_keypoint].on('click', function(){
                occludedStates[i_keypoint] = (occludedStates[i_keypoint] == "2") ?  "1" : "2";
                shape[i_keypoint].updateVisibility(occludedStates[i_keypoint]);
                trackController.onchangekeypointgeometry(shape);
            })

            if (trackModel.trackType == 'interpolation') {
                occludedButtons[i_keypoint].appendTo(skelKeypoints);
            }
        }
        ui.append(skelKeypoints);

        return ui;
    }

    static makeShape(position, type, colors,id) {
        if (type == 'box') {
            return TrackView.makeBox(position, colors);
        }
        else if (type == 'skel') {
            return TrackView.makeSkel(position,colors,id);
        }
        else throw new Error('Unknown shape type');
    }

    static makeConnections(shape,connections,keypoint_names,id,colors){

        var svgLines = [];
        for(var conn = 0; conn < connections.length; conn++){

            // For each connection

            var keyp1, keyp2 = null;
            for(var i =0; i < shape.length; i++){

                if ($(shape[i]).attr("name") == connections[conn][0]){
                    keyp1 = $(shape[i]);
                }
                else if ($(shape[i]).attr("name") == connections[conn][1]){
                    keyp2 = $(shape[i]);
                };
            }

            if (keyp1 && keyp2){

            var svgLine =  $(document.createElementNS('http://www.w3.org/2000/svg', 'line')).attr({
                        'stroke': colors.border,
                 'x1': $(keyp1).attr('cx'),
                 'y1': $(keyp1).attr('cy'),
                 'x2': $(keyp2).attr('cx'),
                 'y2': $(keyp2).attr('cy'),
                 'track_id' : id,
                 'id1' : $(keyp1).attr('name'),
                 'id2' : $(keyp2).attr('name'),
                    }).addClass('shape changeable');

            svgLine.updatePos = function(pos){
                    $(this).attr({
                        'x1' : pos.x1,
                        'y1' : pos.y1,
                        'x2' : pos.x2,
                        'y2' : pos.y2,
                        'id1' : pos.id1,
                        'id2' : pos.id2
                    })
                };

            svgLines.push(svgLine);
            }
        }
        return svgLines;
    }

    static makeBox(pos, colors) {
        let svgRect = $(document.createElementNS('http://www.w3.org/2000/svg', 'rect')).attr({
            x: pos.xtl,
            y: pos.ytl,
            width: pos.xbr - pos.xtl,
            height: pos.ybr - pos.ytl,
            stroke: colors.border,
            fill: colors.background
        }).addClass('shape changeable');

        svgRect.updatePos = function(pos) {
            svgRect.attr({
                x: pos.xtl,
                y: pos.ytl,
                width: pos.xbr - pos.xtl,
                height: pos.ybr - pos.ytl,
            });
        };
        return svgRect;
    }

    static makeSkel(pos,colors,id) {

        // Need to return a list of keypoints of the right color here.
        var svgCircles = [];
        var svgCircle;

        for (var i = 0; i < pos.skel.length; i++){

            svgCircle = $(document.createElementNS('http://www.w3.org/2000/svg', 'circle')).attr({
                cx: pos.skel[i][0],
                cy: pos.skel[i][1],
                track_id : id,              // for identifying other keypoints belonging to same
                name: pos.skel[i][2]       // skeleton
            }).addClass('shape changeable');

            if (pos.skel[i][2] == "center") {
                svgCircle.attr({
                    stroke : '#00ff00',
                    r: 7
                })
            } else {
                svgCircle.attr({
                    stroke : 'blue',//colors.border,
                    fill : 'blue',
                    r : 5
                })
            }

            svgCircle.updatePos = function(skel) {
                $(this).attr({
                    cx: skel[0],
                    cy: skel[1],
                });
            };

            svgCircle.updateVisibility = function(visibility){

                 //If outside, doesn't matter
                // If occluded (visibility = 1), transparent
                // If visible, opaque

                if(visibility == "1"){
                    $(this).attr({
                        'stroke-dashoffset' : "1",
                        'stroke-dasharray' : "2, 1"
                    })
                }
                else {
                    $(this).removeAttr('stroke-dashoffset');
                    $(this).removeAttr('stroke-dasharray');
                }
                $(this).attr('visibility', visibility);

            }
            svgCircle.updateVisibility(pos.skel[i][3]);
            svgCircles.push(svgCircle)
        }

        return svgCircles;
    }

    static makeText(interpolation, labelName, id,colors) {
        let pos = interpolation.position;
        let attributes = interpolation.attributes;

        var shapeX;
        var shapeY;
        var shapeW;

        if (!(interpolation.position.hasOwnProperty('skel'))){
            shapeX = pos.xtl;
            shapeY = pos.ytl;
            shapeW = pos.xbr - pos.xtl;
        }
        else {
            var shapesX = [];
            var shapesY = [];
            for (var i = 0; i < interpolation.position.skel.length; i++){
                shapesX.push(interpolation.position.skel[i][0]);
                shapesY.push(interpolation.position.skel[i][1]);
            }

            shapeX = Math.min(...shapesX); // xtl of bbox fitting skeleton joints
            shapeY = Math.min(...shapesY); // ytl of fitting bbox
            shapeW = Math.max(...shapesX) - Math.min(...shapesX);
        }

        let svgText = document.createElementNS('http://www.w3.org/2000/svg', 'text');

        svgText.setAttribute('x', shapeX + shapeW);
        svgText.setAttribute('y', shapeY);

        svgText.setAttribute('class', 'shapeText regular');

        let labelNameText = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');

        // Defines text
        labelNameText.innerHTML = `Worker ${id}`;

        labelNameText.setAttribute('dy', '1em');
        labelNameText.setAttribute('x', shapeX + shapeW);
        labelNameText.setAttribute('class', 'bold');
        labelNameText.setAttribute('fill', colors.border);
        svgText.appendChild(labelNameText);
        for (let attrKey in attributes) {
            let attribute = attributes[attrKey];
            let attrRow = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
            let value = attribute.value;
            if (value === AAMUndefinedKeyword) value = "";

            // Defines text
            attrRow.innerHTML = `${attribute.name.normalize()}: ${value}`;

            attrRow.setAttribute('dy', '1em');
            attrRow.setAttribute('x', shapeX + shapeW);
            attrRow.setAttribute('fill', colors.border);
            svgText.appendChild(attrRow);
        }
        return $(svgText);
    }

    static makeKeypointTexts(interpolation,colors) {

        var svgTextList = [];

        if (!(interpolation.position.hasOwnProperty('skel'))) {
            //should throw an error
        }
        else {

            for (var i = 0; i < interpolation.position.skel.length; i++) {

                let svgText = document.createElementNS('http://www.w3.org/2000/svg', 'text');

                svgText.setAttribute('x', interpolation.position.skel[i][0]);
                svgText.setAttribute('y', interpolation.position.skel[i][1]);

                svgText.setAttribute('class', 'regular');
                svgText.setAttribute('font-size', '1.6em');
                svgText.setAttribute('fill', 'white');
                svgText.setAttribute('text-shadow', '0px 0px 3px black');
                svgText.setAttribute('cursor', 'default');

                let labelNameText = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');

                if (interpolation.position.skel[i][2].includes('right')){
                    labelNameText.innerHTML = "R";
                } else if (interpolation.position.skel[i][2].includes('left')){
                    labelNameText.innerHTML = "L";
                }

                labelNameText.setAttribute('dy', '1em');
                labelNameText.setAttribute('x', interpolation.position.skel[i][0]);
                labelNameText.setAttribute('name',interpolation.position.skel[i][2]);
                labelNameText.setAttribute('class', 'bold');
                svgText.appendChild(labelNameText);
                svgTextList.push(svgText);
            }

            return svgTextList;
        }
    }


    static makeAttr(type, name, value, values, key, id) {
        if (type === 'checkbox') {
            return TrackView.makeCheckBoxAttr(name, value, key, id);
        }
        else if (type === 'radio') {
            return TrackView.makeRadioAttr(name, value, values, key, id);
        }
        else if (type === 'number') {
            return TrackView.makeNumberAttr(name, value, values, key, id);
        }
        else if (type === 'text') {
            return TrackView.makeTextAttr(name, value, key, id);
        }
        else if (type === 'select') {
            return TrackView.makeSelectAttr(name, value, values, key, id);
        }
        else throw new Error('Unknown attribute type');
    }

    static makeCheckBoxAttr(name, value, key, id) {
        let div = document.createElement('div');

        let label = document.createElement('label');
        label.innerText = `${name.normalize()}`;
        label.setAttribute('for', `${id}_${name}_checkbox`);

        let check = document.createElement('input');
        check.setAttribute('type', 'checkbox');
        check.setAttribute('name', `${key}`);
        check.setAttribute('id', `${id}_${name}_checkbox`);
        check.checked = +value;
        check.onchange = function(e) {
            let key = e.target.name;
            let value = e.target.checked;
            div.onchangeattribute(key, value);
        };

        check.onkeydown = function(e) {
            e.preventDefault();
        };

        div.appendChild(check);
        div.appendChild(label);
        return $(div);
    }


    static makeRadioAttr(name, value, values, key, id) {
        let fieldset = document.createElement('fieldset');
        let legend = document.createElement('legend');
        legend.innerText = `${name.normalize()}`;
        fieldset.appendChild(legend);
        for (let val of values) {
            let div = document.createElement('div');
            let label = document.createElement('label');
            let radio = document.createElement('input');
            radio.onchange = function(e) {
                if (e.target.checked) {
                    fieldset.onchangeattribute(key,val);
                }
            };

            if (val === value) {
                radio.setAttribute('checked', true);
            }

            radio.setAttribute('type', 'radio');
            radio.setAttribute('name', `${id}_${key}`);
            radio.setAttribute('id', `${id}_${name}_${val.toJSId()}_radio`);
            radio.setAttribute('value', `${val}`);

            label.setAttribute('for', `${id}_${name}_${val.toJSId()}_radio`);
            if (val === AAMUndefinedKeyword) {
                label.innerText = `${""}`;
            }
            else {
                label.innerText = `${val.normalize()}`;
            }


            div.appendChild(radio);
            div.appendChild(label);
            fieldset.appendChild(div);
        }

        fieldset.classList = 'uiRadio';
        fieldset.onkeydown = function(e) {
            e.preventDefault();
        };

        return $(fieldset);
    }


    static makeSelectAttr(name, value, values, key, id) {
        let div = document.createElement('div');
        let label = document.createElement('label');

        //TODO: find where this is declared
        //TODO: customized this for our purposes
        //label.innerText = 'Type';//`${name.normalize()}`;

        let select = document.createElement('select');
        select.classList = 'regular';
        select.setAttribute('name', `${key}`);
        select.setAttribute('id', `${id}_${name}_select`);
        //select.style['margin-left'] = '5px';

        //TODO: added margin right
        select.style['margin-right'] = '0px';

        select.className += " uiSelect";


        for (let val of values) {
            let option = document.createElement('option');
            if (val === AAMUndefinedKeyword) val = "";
            option.innerText = `${val}`;
            select.add(option);
        }

        select.value = value;
        select.onchange = function(e) {
            let key = e.target.name;
            let value = e.target.value;
            value = (value === '' ? AAMUndefinedKeyword : value);
            div.onchangeattribute(key, value);
        };

        select.onkeydown = function(e) {
            e.preventDefault();
        };

        //div.appendChild(label);
        div.appendChild(select);
        return $(div);
    }



    static makeTextAttr(name, value, key, id) {
        let div = document.createElement('div');
        let label = document.createElement('label');
        label.innerText = `${name.normalize()}`;

        let text = document.createElement('input');
        text.setAttribute('type', 'text');
        text.setAttribute('value', `${value}`);
        text.setAttribute('name', `${key}`);
        text.setAttribute('id', `${id}_${name}_text`);
        text.oninput = function() {
            let value = text.value;
            div.onchangeattribute(key,value);
        };
        text.style['width'] = '50%';
        text.style['margin-left'] = '5px';

        div.appendChild(label);
        div.appendChild(text);

        let stopProp = function(e) {
            let key = e.keyCode;
            let serviceKeys = [37, 38, 39, 40, 13, 16, 9, 109];
            if (serviceKeys.includes(key)) {
                e.preventDefault();
                return;
            }
            e.stopPropagation();
        };

        text.onkeypress = stopProp;
        text.onkeydown = stopProp;
        text.onkeyup = stopProp;

        return $(div);
    }



    static makeNumberAttr(name, value, values, key, id) {
        let [min, max, step] = values;
        let div = document.createElement('div');
        let label = document.createElement('label');
        label.innerText = `${name.normalize()}`;

        let number = document.createElement('input');
        number.setAttribute('type', 'number');
        number.setAttribute('value', `${value}`);
        number.setAttribute('step', `${step}`);
        number.setAttribute('min', `${min}`);
        number.setAttribute('max', `${max}`);
        number.setAttribute('id', `${id}_${name}_number`);
        number.oninput = function() {
            let value = +number.value;
            if (value > +max) value = +max;
            else if (value < +min) value = +min;
            number.value = value;
            div.onchangeattribute(key,value);
        };
        number.style['width'] = '50%';
        number.style['margin-left'] = '5px';

        div.appendChild(label);
        div.appendChild(number);

        let stopProp = function(e) {
            let key = e.keyCode;
            let serviceKeys = [37, 38, 39, 40, 13, 16, 9, 109];
            if (serviceKeys.includes(key)) {
                e.preventDefault();
                return;
            }
            e.stopPropagation();
        };

        number.onkeypress = stopProp;
        number.onkeydown = stopProp;
        number.onkeyup = stopProp;

        return $(div);
    }
}


