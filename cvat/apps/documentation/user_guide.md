# CEE 320 Worker keypoint annotation tool - User's Guide

[toc]

## Getting started

### Authorization

- After we create your group's annotation tool account you will then be able to log in at visualconstruction.cee.illinois.edu:

   ![](static/documentation/images/image001.jpg)

- The TAs will assign an annotation task to you. Once this is done, you will have access to the task when you log in. Click on the hyperlink under the "Jobs" column on the right side of the screen to start annotating. 
  

### Basic navigation

1. Use arrows below to move on next/previous frame. To see the keyboard shortcut, hover your mouse pointer over an UI element (D and F keys for left and right respectively).

    ![](static/documentation/images/image008.jpg)

2. An image can be zoomed in/out using the mouse wheel. The image will be zoomed relative to your current cursor position. Thus if you point on an object it will be under your mouse during zooming process.

3. An image can be moved/shifted by clicking/dragging the image.

### How to annotate

1. Create a worker by pushing the "Create Worker" button on the bottom right of the screen. Until your next click, moving your cursor over the image will move the construction worker skeleton. Upon your next click, you will create a worker. **Important note:** by convention, we define the *left side* of a worker as corresponding to the left side of a worker as viewed from behind. To **flip left/right worker keypoints**, press ``Ctrl`` **before** you place the worker.

    ![](static/documentation/images/createworker.png)
       
2. To modify skeleton keypoint positions:
   - To modify an *individual* keypoint's position, just click and drag the corresponding keypoint. 
     The position of the green "Center" keypoint automatically shifts to the centroid of the smallest bounding box encompassing all keypoints. Therefore, if moving an individual keypoint changes this bounding box, the green "Center" keypoint will shift slightly.
   - To modify *all* keypoints' positions, click and drag the green "Center" keypoint.
   - **Interpolating keypoints**:
      - If you modify a keypoint on frame n, frame n will become a *key frame* for that keypoint's skeleton. Frame 0 is always a keyframe for all skeletons.
      - When a key frame is created, all keypoint positions will be linearly interpolated between the previous keypoint's frame and the new key frame.
      - This means that **if a keypoint's motion from frame n to frame m is linear, to annotate this keypoint, you therefore only have to annotate frames n and frames m - not the frames inbetween**. With this technique you should be able to save a lot of annotation time.
     
4. To modify skeleton keypoint visibilities:
   - Individual keypoint visibility can be modified by
      - Clicking on the chevron in the corresponding worker's box in the panel on the right side of the page. A list of keypoints drops down with corresponding visibility icons.
      - Click on the keypoint's visibility icon to occlude it (the corresponding keypoint circle will now appear with a dashed boundary). Click on the icon again to render it visible.
      - **Interpolation behavior**:
         - When a keypoint's visibility is changed, this frame becomes a keyframe for the skeleton. The visibility of all keypoints are constant for all frames up until the next keyframe (when the keypoint's visibility changes to its visibility on that frame).
         
5. To modify worker per-frame activity labels.
   - Click on the label menu in the corresponding worker's box in the panel on the right side of the page.
   - Select the corresponding activity label from the menu that appears.
   - **Interpolation behavior**:
      - As for individual keypoint visibilities, a frame where a label change is made becomes a keyframe for that skeleton, and the label remains constant up to the next keyframe.

6. When an annotated worker disappears from the screen, you need to finish the track. To do that you need to click on the "Outsided Property" icon. The skeleton will then disappear on that frame, and its corresponding box on the panel on the right side of the page will disappear on all subsequent frames. **Note**: the skeleton will reappear when rewinding to frames before the track finishes.
    
   

### Vocabulary

---
**Annotation** is a set of bounding boxes and tracks. There are several types of annotations:
- *Manual* which is created by a person
- *Semi-automatic* which is created automatically but modified by a person
- *Automatic* which is created automatically without a person in the loop
---
### Navigation by frames/images

![](static/documentation/images/image035.jpg)

---
Go to the next/previous frame with a predefined step. Shortcuts: ``v`` — step backward, ``c`` — step forward. By default the step is ``10``.

![](static/documentation/images/image037.jpg)

To change the predefined step go to settings (``Open Menu`` —> ``Settings``) and modify ``Player Step`` property.

![](static/documentation/images/image038.jpg)

![](static/documentation/images/image039.jpg)

### Open Menu
It is the main menu for the annotation tool. You can use it to remove all existing annotations, to change player settings and to save your existing work.

### Settings

The menu contains different parameters which can be adjust by the user needs. For example,``Player Step``, ``Player Speed``.

![](static/documentation/images/image052.jpg)

 - ``Brightness`` makes it appear that there is more or less light within the image.
 - ``Contrast`` controls the difference between dark and light parts of the image
 - ``Saturation`` takes away all color or enhance the color.
