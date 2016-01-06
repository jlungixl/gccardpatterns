// requires: dd, transition, event, array-invoke, event-focus
// requires[q]: DOMAttachAware, DynamicUIStabilizerDD, GC, KeyboardFocusManager, SortingDragTile, Guessable
// requires[q-css]: DragAndDropBase
// requires[util]: DragFlick

// static variables
// Base z-index for dragged items. Sync'ed up with DragAndDropBase.css.
var BASE_Z_INDEX = 10;

// min speed of a user's finger for a drag flick gesture
var minDragFlickSpeed = 0.8; // pixels per ms

// in order for a touch gesture to be a drag flick, the angle between the
// velocity vector of the user's finger and the vertical must be <= minDragFlickAngle.
var minDragFlickAngle = Math.PI / 6;

// If the mouse moves further than this distance during a click gesture, click
// to move mode will not be activated.
var CLICK_DISTANCE_THRESHOLD = 10;

// If a click gesture takes longer than this time (in milliseconds), then click
// to move mode will not be activated.
var CLICK_TIME_THRESHOLD = 200;

// a little extra grace period for old ie
if (Y.UA.ie && Y.UA.ie < 10) {
  CLICK_TIME_THRESHOLD = 350;
}

var DISTANCE_PER_KEYPRESS = 10; // pixels

var DRAG_PIXEL_THRESH = 5; // pixels

// If scrolling is enabled, how close does a drag need to be to screen edge
// before scrolling is initiated.
var SCROLL_BUFFER = 40;

// If scrolling is enabled, how far should each scroll step scroll the screen (in px)?
var SCROLL_DIST = 1;

// How frequently should scroll steps kick in (in ms)?
var SCROLL_DT = 3;


// Set YUI's click time threshold to 0.
Y.DD.Drag.ATTRS.clickTimeThresh.value = 0;
Y.DD.Drag.ATTRS.clickPixelThresh.value = 0;

// Allowed elapsed time between a key release and a subsequent keydown before
// moving item is released.
var KEYBOARD_TIME_DELAY = 600;


// static methods

// Prevent default.
function preventDefault(e) {
  e.preventDefault();
}


/**
 * A base 'class' for drag and drop gcs.
 * This file is intended to hold onto some code that is used by all
 * drag-and-drop gcs.
 *
 * @author koconnor 1-13-2015
 */
Q.DragAndDropBase = Y.Base.create('dragAndDropBase', Q.GC, [Q.DOMAttachAware, Q.DynamicUIStabilizerDD, Q.Guessable, Q.KeyboardFocusManager],
{
  /** Should we make all the draggable items the same size? */
  shouldNormalizeDragSizes: true,

  /** Should click-to-move UI be enabled? */
  enableClickToMove: true,

  /** Sizes of the draggable items. */
  dragSizes: null,

  initializer: function(cfg) {
    this._dragDelegate = null;
    this._eventHandles = [];
    this._drops = [];
    this.nodesToResize = [];
    this.clickToMoveNode = null;
    this.zStack = [];
    this.allowScrolling = false;
    this.keyboardTimeDelay = KEYBOARD_TIME_DELAY;
  },

  destructor: function() {
    if (this._dragDelegate) {
      // Re-implemented dd-delegate's destructor method, since its implementation is buggy for drops
      var dd = this._dragDelegate.dd;
      if (dd) {
        dd.destroy();
      }
      Y.Array.invoke(this._dragDelegate._handles, 'detach');
    }

    Y.Array.invoke(this._eventHandles, 'detach');
    Y.Array.invoke(this._drops, 'destroy');

    this.clearClickToMove();
    clearTimeout(this.scrollTimeout);
  },


  /**
   * Render method for this component.
   * Components that extend this base class should implement _render rather than
   * override this method.
   */
  render: function() {
    var out = this._parentNode;
    var container = this.dragAndDropContainer = out.appendChild('<div class="dragAndDropContainer" />');
    this._render(container);
  },

  /**
   * Render the specific contents of this drag-and-drop gc.
   * @abstract
   */
  _render: function(container) {},

  /**
   * Utility method for setting up a Y.DD.Delegate for the draggable items of
   * of this gc.
   */
  setUpDragDelegateAndContainer: function(container, constrain) {

    // Be sure to pass the containerID for the container attribute and the actual
    // YNode instance for the constrain node.
    this._dragDelegate = new Y.DD.Delegate({
      container: '#' + container.generateID(),
      nodes: '.' + Q.DragAndDropBase.DRAG_SELECTOR_CLASS
    });

    this._dragDelegate.dd.plug(
      Y.Plugin.DDConstrained, {
      constrain: constrain || container   // This should be the YNode instance, NOT the ID
    });

    container.addClass('interactive');
  },

  /**
   * Given a YUI node, make that node a Y.DD.Drop.
   * Any Y.DD.Drop created here will be automatically destroyed in the
   * destructor of this base class.
   */
  createDrop: function(dropNode) {
    dropNode.addClass('dropArea');
    if (dropNode.getDOMNode()) {
      this._drops.push(new Y.DD.Drop({
        node: dropNode.getDOMNode()
      }));
    }
    else {
      this.inDocDo(Y.bind(function() {
        this._drops.push(new Y.DD.Drop({
          node: dropNode.getDOMNode()
        }));
      }, this));
    }
  },

  /**
   * Wrapper function around createDragOldOrNew. Old drag and drop gc's call this method.
   */
  createDrag: function(container, qm, makeInteractive) {
    return this.createDragOldOrNew(container, qm, makeInteractive, false);
  },

  /**
   * Get a draggable item.
   */
  createDragOldOrNew: function(container, qm, makeInteractive, useNewUI) {
    var wrapper = container.appendChild('<div />');
    wrapper.addClass('dragWrapper');
    if (useNewUI) {
      wrapper.addClass('solidUI');
    }
    if (useNewUI) {
      var context = this;
      wrapper._qm = this._getItemQM(qm, wrapper, context);
    }
    else {
      wrapper._qm = qm;
    }
    wrapper._qm.doNotSetInlineStyles = false;
    if (makeInteractive) {
      wrapper.addClass(Q.DragAndDropBase.DRAG_SELECTOR_CLASS);
      if (wrapper._qm.setStaticUI) {
        wrapper._qm.setStaticUI(false);
      }
      this.zStack.push(wrapper);
    }
    else {
      wrapper.addClass('static');
    }

    // Initialize the top and left styles to something concrete.
    // If we do not set this here, then top and left will default to 'auto'.
    // If you try to css-transition this node from {left: auto, top: auto}
    //   to a concrete location, the transition will fail and the node will
    //   just move abruptly to the concrete location.
    wrapper.setStyles({
      left: '0px',
      top: '0px'
    });

    if (useNewUI) {
      var itemContent = wrapper.appendChild('<div />');
      itemContent.addClass('itemContent');
      qm._parentNode = itemContent;
    }
    else {
      qm._parentNode = wrapper;
    }
    wrapper._qm._parentNode = wrapper;

    qm.render();
    if (wrapper._qm.setDisabledUI) {
      wrapper._qm.setDisabledUI(!this.get('context').isInteractive);
    }

    if (wrapper._qm.setDraggingUI) {
      wrapper._qm.setDraggingUI(false);
    }
    if (wrapper._qm.setSelectedUI) {
      wrapper._qm.setSelectedUI(false);
    }
    if (wrapper._qm.setFocusUI) {
      wrapper._qm.setFocusUI(false);
    }
    if (wrapper._qm.setHoverUI) {
      wrapper._qm.setHoverUI(false);
    }
    return wrapper;
  },

  _getItemQM: function(item, dragWrapper, context) {
    return Q.Component.newInstance(context, Q.SortingDragTile, {
      label: item,
      node: dragWrapper
    });
  },

  /**
   * Function that will 'remove' a node.  In reality, this will sneakily
   * move a node back to the itemBankDropSlot whence it came (or to the
   * passed drop parameter).
   */
  fakeRemoveNode: function(node, drop) {
    var port = drop || node.currentPort || node.get('parentNode');

    this.clickToMoveNode = undefined;
    this.focusedNode = undefined;
    node.addClass(Q.DragAndDropBase.DRAG_SELECTOR_CLASS);
    node.addClass(Q.KeyboardFocusManager.FOCUS_SELECTOR_CLASS);
    // case 83028: make sure nodes aren't hovered when they return to their
    // port.
    if (node._qm.setHoverUI) {
      node._qm.setHoverUI(false);
    }
    node.removeClass('hover');
    if (node.one('.dragTile')) {
      node.one('.dragTile').removeClass('hover');
    }
    this._handleClickToMoveDeselect(node);

    this.abruptMove(node, port);
    node.setStyles({opacity: 1});
    this.hideDummyNode(port);
  },

  /**
   * Remove a draggable item.
   */
  removeDrag: function(wrapper) {
    wrapper.removeClass(Q.DragAndDropBase.DRAG_SELECTOR_CLASS);
    var index = this.zStack.indexOf(wrapper);
    if (index >= 0) {
      this.zStack.splice(index, 1);
    }
  },

  /**
   * Smoothly move a drag to a particular coordinate location.
   * Points should be given in pixel coordinates, with (0, 0) corresponding
   * to the drag being directly inside its parent element.
   */
  _smoothMoveToCoordinates: function(drag, x, y, deleteAfterMove, callback) {
    var transitionTimeMS = Y.Lang.isValue(this.dropTransitionTime)
      ? this.dropTransitionTime
      : Q.DragAndDropBase.TRANSITION_TIME_MS;

    // We are maintaining the guarantee right now that all draggable items
    // have a pretty immediate ancestor with position: relative. This means
    // that top: 0, left: 0 corresponds to the drag being directly inside its
    // parent.
    var currentLeft = parseInt(drag.getStyle('left'), 10);
    var currentTop = parseInt(drag.getStyle('top'), 10);

    // Don't initiate a smooth move if we are already at the destination.
    if (currentLeft === x && currentTop === y) { return; }

    drag.addClass(Q.DragAndDropBase.MOVING_CLASS);
    drag.removeClass(Q.DragAndDropBase.DRAG_SELECTOR_CLASS);

    // Initiate the smooth move.
    drag.transition({
      duration: transitionTimeMS / 1000,
      easing: 'ease',
      left: x + 'px',
      top: y + 'px'
    });

    // set up handler for when the transition is over.
    setTimeout(function() {
      // the node is no longer moving.
      drag.removeClass(Q.DragAndDropBase.MOVING_CLASS);
      // Enable the drag tile to be dragged again.
      drag.addClass(Q.DragAndDropBase.DRAG_SELECTOR_CLASS);

      if (deleteAfterMove && this.doubleCheckBeforeDeleting(drag)) {
        this.removeDrag(drag);

        // Case 80121:  We remove drag from the DOM, we still have a
        // reference to the drag YNode instance.  This results in
        // this.clickToMoveNode being non-null, but
        // this.clickToMoveNode._node being null.  -rlaber
        if (this.clickToMoveNode === drag) {
          this.clickToMoveNode = undefined;
        }
        this.fakeRemoveNode(drag);
      }
      else {
        drag.removeClass('dragging');
        if (drag._qm && typeof(drag._qm.setDraggingUI) === 'function') {
          drag._qm.setDraggingUI(false);
        }
      }

      this.stopListeningToKeys = false;

      if (callback) {
        callback();
      }
    }.bind(this), transitionTimeMS);
  },

  /**
   * Method to double check that we can and should proceed with
   * removing drag from the DOM and destroying it.  This default implementation
   * always returns true, so you can override this to add a customized
   * doublecheck for strange buggy edge-cases (for example, rapid clicking
   * can cause drag:ends without corresponding drag:starts). This was added to
   * fix bug 76632.  -rlaber
   */
  doubleCheckBeforeDeleting: function(drag) {
    return true;
  },

  /**
   * Smoothly move drag to drop.
   */
  smoothMove: function(drag, drop, deleteAfterMove, callback) {
    if (drop) {
      // We are maintaining the guarantee right now that all draggable items
      // have a pretty immediate ancestor with position: relative. This means
      // that top: 0, left: 0 corresponds to the drag being directly inside its
      // parent.
      var parent = drag.ancestor();
      var newLeft = drop.getX() - parent.getX();
      var newTop = drop.getY() - parent.getY();

      this._smoothMoveToCoordinates(drag, newLeft, newTop, deleteAfterMove, callback);
    }
  },

  /** Abruptly move a drag to a drop. */
  abruptMove: function(drag, drop) {
    // We are maintaining the guarantee right now that all draggable items
    // have a pretty immediate ancestor with position: relative. This means
    // that top: 0, left: 0 corresponds to the drag being directly inside its
    // parent.
    var parent = drag.ancestor();
    var newLeft = drop.getX() - parent.getX();
    var newTop = drop.getY() - parent.getY();

    drag.setStyle('left', newLeft + 'px');
    drag.setStyle('top', newTop + 'px');
  },

  /**
   * Utility method for normalizing the widths of all the draggable elements.
   * Should be called after the DOM is attached.
   * returns an object of the form
   *     { width: [width of widest], height: [height of tallest] }
   */
  normalizeDragSize: function(container) {
    var maxWidth = 0;
    var maxHeight = 0;
    var region;
    if (!this.dragSizes) {
      container.all('.dragWrapper').each(function(drag) {
        // if drag contains a labeledItem, size the drag based on the item, not the label.
        if (drag.one('.labeledItem')) {
          var item = drag.one('.labeledItem .row .cell');
          var label = drag.one('.labeledItem .row:nth-child(2) .cell');

          // Make sure label content doesn't wrap, otherwise the labels will become very tall.
          // case 76971
          label.setStyles({
            maxWidth:  '1px',
            whiteSpace: 'nowrap'
          });
          region = item.get('region');
          maxWidth = Math.max(maxWidth, region.width);
          maxHeight = Math.max(maxHeight, region.height);
        }
        else {
          region = drag.get('region');
          var borderWidth = drag.one('*').getStyle('borderLeftWidth');
          if (borderWidth) {
            borderWidth = 2 * parseInt(borderWidth, 10);
          }
          if (region.width - borderWidth > maxWidth) { maxWidth = region.width - borderWidth; }
          if (region.height - borderWidth > maxHeight) { maxHeight = region.height - borderWidth; }
        }
      });

      this.dragSizes = { width: maxWidth, height: maxHeight };
    }

    var maxSizes = this.dragSizes;
    container.all('.dragWrapper').each(function(drag) {
      // drag is a wrapper around the substantive draggable item. So set width
      //  and height styles on the child of drag rather than on the drag itself.
      var nodeToResize = drag.one('div') || drag;
      nodeToResize.setStyles(maxSizes);
    });

    // if the tiles have labeled items, then make sure the label entries all
    // have the same height
    if (container.one('.dragWrapper .labeledItem')) {
      container.all('.dragWrapper .labeledItem .row:nth-child(2) .cell').each(function(label) {
        label.setStyles({
          maxWidth:  maxWidth
        });
      });

      var maxLabelHeight = 0;
      container.all('.dragWrapper .labeledItem .row:nth-child(2) .cell').each(function(label) {
        region = label.get('region');
        maxLabelHeight = Math.max(region.height, maxLabelHeight);
      });

      this.dragSizes.maxLabelHeight = maxLabelHeight;

      container.all('.dragWrapper .labeledItem .row:nth-child(2) .cell').each(function(label) {
        label.setStyles({
          height: maxLabelHeight,
          whiteSpace: 'normal'   // make sure to let text wrap now
        });
      });
    }

    for (var i = 0; i < this.nodesToResize.length; i++) {
      this.nodesToResize[i].setStyles(maxSizes);
    }
    this.nodesToResize = [];

    return maxSizes;
  },

  /**
   * Set the given node's width and height so that it is the same size as the drags.
   */
  normalizeNodeWithDrags: function(node) {
    // if the correct drag sizes have already been computed...
    if (this.dragSizes) {
      node.setStyles(this.dragSizes);
    }
    // otherwise, resize node after drag nodes have been sized.
    else {
      this.nodesToResize.push(node);
    }
  },

  /**
   * Set up drag events.
   */
  setUpEvents: function(container) {

    // The total length of the drag event.  This is to negate a drag event that was
    // actually just a really long click.  See case 69673 -rlaber 6/11/15
    var dragPixelLength = 0;

    this._eventHandles.push(container.delegate('touchstart', preventDefault,
        '.' + Q.DragAndDropBase.DRAG_SELECTOR_CLASS));

    // Prevents highlighting of text in tiles in ie8.
    this._eventHandles.push(container.on('selectstart', preventDefault));

    // Ensures that tiles go back to their proper location if you do a 5-finger
    //  close gesture while dragging.
    this._eventHandles.push(Y.on('touchcancel', this.stabilize));

    var del = this._dragDelegate;

    if (this.enableClickToMove) {
      this.setUpClickToMoveEvents(container, del);
    }
    else {
      // todo: set up double click handler.
    }


    var removeHover = function(drag) {
      if (drag._qm && drag._qm.setHoverUI) {
        drag._qm.setHoverUI(false);
      }
      drag.removeClass('hover');
    };

    var addHover = function(drag) {
      if (drag._qm && drag._qm.setHoverUI) {
        drag._qm.setHoverUI(true);
      }
      drag.addClass('hover');
    };

    // set up events for hover
    // using mousemove rather than mouseenter/mouseleave after fixing bug 71344
    // mouseleave was being triggered on mousedown, which was causing the hover
    // state to be cleared before the dragging state was added.
    var hovered = null;
    this._eventHandles.push(Y.on('mousemove', function(e) {
      if (!Y.UA.android && !Y.UA.ios && !this.dragInProgress) {
        var drag = this._isOverDrag(e.pageX, e.pageY);
        if (drag) {
          if (drag.hasClass(Q.DragAndDropBase.MOVING_CLASS)) {
            // Ignore mouse events for this drag - fix smooth-move flicker bug.
            return;
          }
          if (hovered && drag !== hovered) {
            removeHover(hovered);
          }
          hovered = drag;
          addHover(drag);
        }
        else if (hovered) {
          removeHover(hovered);
          hovered = null;
        }
      }
    }.bind(this)));

    this._eventHandles.push(del.on('drag:end', Y.bind(function(e) {
      this.dragInProgress = false;
      var dragNode = e.target.get('node');

      if (e.target.get('move')) {
        if (this.focusedNode) {
          this.focusedNode.blur();
        }
        this._handleDragEnd(dragNode, e, function() {});
      }
      dragNode.numberOfTicksMoved = 0;
    }, this)));

    this._eventHandles.push(del.on('drag:start', Y.bind(function(e) {

      var clickedNode = e.target.get('node');
      var focusedNode = Y.one('.focused') || Y.one('.selected');

      clickedNode.numberOfTicksMoved = 0;
      this.dragInProgress = true;

      // Check if we just clicked on a different dragNode.
      if (focusedNode && clickedNode !== focusedNode) {
        this._handleClickToMoveDeselect(focusedNode);
      }


      if (!this.enableClickToMove) {
        this._handleDragStart(clickedNode, e);
      }
    }, this)));

    this._eventHandles.push(del.on('drag:drag', Y.bind(function(ev) {
      this._handleDragDrag(ev.target.get('node'), ev);
    }, this)));

    // Handlers for touch-screens only
    if (Y.UA.touchEnabled) {
      // If a draggable is flicked, send it back to its starting location.
      this._eventHandles.push(container.delegate('drag-flick', function(e) {
        // If this flick has a speed greater than minDragFlickSpeed and is upward,
        //   send the draggable node back to the top row.
        if (e.speed >= minDragFlickSpeed
          && (e.velocity.y / e.speed < -Math.cos(minDragFlickAngle)))
        {
          this.flickHappened = true;
          this.handleDragFlick(e.drag.get('node'));
        }
      }, '.draggableTile', this));
    }
  },

  /** Clear all the event handlers and meta-variables that comprise click-to-move mode. */
  clearClickToMove: function() {
    if (this.clickToMoveNode) {
      this.clickToMoveNode.blur();
    }
    this.clickToMoveNode = null;
    if (this.dragAndDropContainer) {
      this.dragAndDropContainer.removeClass('clickToMoveMode');
    }

    // detach all temporary event handles.
    if (this._mouseDownHandle) {
      this._mouseDownHandle.detach();
    }
    if (this._touchStartHandle) {
      this._touchStartHandle.detach();
    }
    if (this._clickToMoveMouseHandle) {
      this._clickToMoveMouseHandle.detach();
    }
    if (this._clickToMoveTouchHandle) {
      this._clickToMoveTouchHandle.detach();
    }
    if (this._mouseUpHandle) {
      this._mouseUpHandle.detach();
    }
    if (this._touchEndHandle) {
      this._touchEndHandle.detach();
    }
  },

  setupClickToMove: function(drag, suppressFocusEvent) {
    // if click to move mode is already set up for this drag, then return
    if (drag === this.clickToMoveNode) {
      return;
    }

    this.clearClickToMove();

    var container = this.dragAndDropContainer;

    // save the selected drag as a state variable
    this.clickToMoveNode = drag;

    // Do some UI setup. Alter the drag's appearance to indicate it is selected.
    this._handleClickToMoveSelect(drag, suppressFocusEvent);

    // now set up some temporary event handles for click to move mode.

    // Handler for mouse/touch end gestures which are not drag:ends.
    // If a mouseup happens which is also a drag:end, then this handler
    // should do nothing.
    var gestureEndCallback = function(pageX, pageY) {
      this.suppressNextBlur = false;
      // set the UI
      this.blurHandler(drag);
      var drop = this._isOverDrop(pageX, pageY);
      if (!drop) {
        this.clearClickToMove();
      }

      if (this._touchEndHandle) { this._touchEndHandle.detach(); }
      if (this._mouseUpHandle) { this._mouseUpHandle.detach(); }
      if (!this.dragInProgress) {
        this.clearClickToMove();
        if (drop) {
          this._handleClickAndDropHit(drag, drop, pageX, pageY, function() {});
        }
        else {
          this._handleClickAndDropMiss(drag, pageX, pageY, function() {});
        }
      }
    }.bind(this);

    var gestureStartHandle = function(pageX, pageY) {

      // Note that this will run after the drophit handler.
      if (this._mouseUpHandle) { this._mouseUpHandle.detach(); }
      this._mouseUpHandle = Y.on('mouseup', function(e) {
        gestureEndCallback(e.pageX, e.pageY);
      }.bind(this));

      if (Y.UA.touchEnabled) {
        if (this._touchEndHandle) { this._touchEndHandle.detach(); }
        // Note that this will run before the drophit handler.
        this._touchEndHandle = Y.on('touchend', function(e) {
          e.preventDefault();
          var touch = e.changedTouches[0];
          if (e.touches.length === 0) {
            gestureEndCallback(touch.pageX, touch.pageY);
          }
        }.bind(this));
      }

      if (!this._isOverDrag(pageX, pageY)) {
        // The only way we are here is if there is a selected node,
        // and we are clicking somewhere that is not another draggable element.
        // We do not want to blur the selected node yet.
        this.suppressNextBlur = true;
        this.handleClickAndMove(drag, pageX, pageY);
        if (this._clickToMoveMouseHandle) { this._clickToMoveMouseHandle.detach(); }
        this._clickToMoveMouseHandle = Y.on('mousemove', Y.bind(function(e) {
          this.handleClickAndMove(drag, e.pageX, e.pageY);
        }, this));
        if (Y.UA.touchEnabled) {
          if (this._clickToMoveTouchHandle) { this._clickToMoveTouchHandle.detach(); }
          this._clickToMoveTouchHandle = Y.on('touchmove', Y.bind(function(e) {
            e.preventDefault();
            e = e.changedTouches[0];
            this.handleClickAndMove(drag, e.pageX, e.pageY);
          }, this));
        }
        this.dragInProgress = false;
      }
      else {
        this.dragInProgress = true;
      }
    }.bind(this);

    // handle which will do work for mousedown events that are not drag:starts.
    // If a mousedown happens on top of a drag, this handler should do nothing.
    this._mouseDownHandle = Y.on('mousedown', function(e) {
      gestureStartHandle(e.pageX, e.pageY);
    });



    // handle which will do work for touchstart events that are not drag:starts.
    // If a touchstart happens on top of a drag, this handler should do nothing.
    this._touchStartHandle = Y.on('touchstart', Y.bind(function(e) {
      if (!this.allowScrolling) {
        e.preventDefault();
      }
      e = e.changedTouches[0];
      gestureStartHandle(e.pageX, e.pageY);
    }, this));

  },

  /**
   * Set up event handlers that facilitate click-to-move mode.
   */
  setUpClickToMoveEvents: function(container, del) {
    var lastMouseDown = null;
    var distanceMoved = 0;
    var lastX = null;
    var lastY = null;

    this.clickToMoveNode = null;

    var gestureStartHandler = function(pageX, pageY) {
      lastMouseDown = +new Date();
      lastX = pageX;
      lastY = pageY;
      distanceMoved = 0;
    }.bind(this);

    this._eventHandles.push(container.on('mousedown', Y.bind(function(e) {
      gestureStartHandler(e.pageX, e.pageY);
    }, this)));
    this._eventHandles.push(container.on('touchstart', function(e) {
      if (!this.allowScrolling) {
        e.preventDefault();
      }
      var touch = e.changedTouches[0];
      gestureStartHandler(touch.pageX, touch.pageY);
    }.bind(this)));

    this._eventHandles.push(container.delegate('mouseup', Y.bind(function(ev) {

      preventDefault(ev);
      this.suppressNextBlur = false;
      ev.stopPropagation();
      if (this.clickToMoveNode && this.clickToMoveNode === ev.currentTarget) {
        this._handleClickToMoveDeselect(this.clickToMoveNode);
        this.clearClickToMove();
        return false; // If we mouseup on the selected node, then deselect it. 76092 -rlaber
      }
      // Deselect the current clickToMoveNode
      this._handleClickToMoveDeselect(this.clickToMoveNode);
      this.clearClickToMove();
      this.setupClickToMove(ev.currentTarget);
    }, this), '.' + Q.DragAndDropBase.DRAG_SELECTOR_CLASS));

    this._eventHandles.push(del.on('drag:start', function(e) {
      e.target.set('move', false);
    }.bind(this)));

    this._eventHandles.push(del.on('drag:drag', function(e) {
      var d = +new Date();
      var pageX = e.target.mouseXY[0];
      var pageY = e.target.mouseXY[1];
      if (Y.Lang.isValue(lastX) && Y.Lang.isValue(lastY)) {
        distanceMoved += Math.sqrt(Math.pow(pageX - lastX, 2) + Math.pow(pageY - lastY, 2));
        if (!e.target.get('move') &&
          (distanceMoved >= CLICK_DISTANCE_THRESHOLD
          || d - lastMouseDown >= CLICK_TIME_THRESHOLD))
        {
          e.target.set('move', true);
          container.all('.' + Q.DragAndDropBase.DRAG_SELECTOR_CLASS).each(this._handleClickToMoveDeselect.bind(this));
          this.clearClickToMove();
          this._handleDragStart(e.target.get('node'), e);
        }
      }
    }.bind(this)));

    this._eventHandles.push(del.on('drag:drophit', Y.bind(function(e) {
      var lastMouseUp = +new Date();
      var drag = e.drag.get('node');
      this.dragInProgress = false;

      // if this is a click, set up click to move mode
      if (!e.target.get('move'))
      {
        // if we are in click-to-move mode, and we have just clicked a new drag...
        if (this.clickToMoveNode) {
          // if we clicked the drag that was selected, just deselect it and return.
          if (this.clickToMoveNode === drag) {
            drag.blur();
            this._handleClickToMoveDeselect(drag);
            this.clearClickToMove();
          }
          // otherwise, deselect the old node and select the new one
          else {
            this._handleClickToMoveDeselect(this.clickToMoveNode);
            this.setupClickToMove(drag);
          }
        }
        // Otherwise, we were not in click to move mode. Select the clicked drag.
        else {
          this.setupClickToMove(drag);
        }

        e.halt(true);
      }
    }, this)));
  },

  //----------------------------------------------------------------------------


  /**
   * Handler for a drag:drophit event where the drop is not the item bank.
   * NOTE: It is a good idea for this handler to update drag.currentPort and
   *       drop.occupant to be appropriate values, given this drophit event.
   * @abstract
   */
  handleDropHit: function(drag, drop, callback) {},

  /**
   * Handler for a drag:dropmiss event.
   * NOTE: It is a good idea for this handler to update drag.currentPort as
   * appropriate, given this dropmiss event.
   * @abstract
   */
  handleDropMiss: function(drag, callback) {
    if (callback) {
      callback();
    }
  },

  /**
   * Handler for the drag:enter event.
   * @abstract
   */
  handleDragEnter: function(drag, drop) {},

  /**
   * Handler for the drag:over event.
   */
  handleDragOver: function(drag, drop) {},

  /**
   * Handler for the drag:exit event.
   * @abstract
   */
  handleDragExit: function(drag, drop) {},

  /**
   * Handler for the drag:start event.
   * @abstract
   */
  handleDragStart: function(drag, ev) {},

  /**
   * Handler for the drag:drag event.
   * @abstract
   */
  handleDragDrag: function(drag, ev) {},


  /**
   * Handler for the drag:end event.  Note that the drag parameter is a YNode with
   * an attribute called numberOfTicksMoved that indicates how many drag:drag events
   * were fired during this drag event.
   * @abstract
   */
  handleDragEnd: function(drag, ev, callback) {
    if (callback) {
      callback();
    }
  },

  /**
   * Handler for the event that the user double-clicks on a draggable item.
   * @abstract
   */
  handleDoubleClick: function(drag) {},

  /**
   * Handler for the drag-flick event.
   * @abstract
   */
  handleDragFlick: function(drag) {},

  /**
   * Intermediate handler for a drag:start event.
   * Can be used to route this event to different handlers if this is desired.
   * @protected
   */
  _handleDragStart: function(dragNode, ev) {
    this._scrollingDirection = null;
//    var dragNode = ev.target.get('node');
    dragNode.addClass('dragging');
    if (dragNode._qm && typeof(dragNode._qm.setDraggingUI) === 'function') {
      dragNode._qm.setDraggingUI(true);
    }

    dragNode.numberOfTicksMoved = 0;

    this.currentDropUnderDrag = dragNode.currentPort ?
      dragNode.currentPort :
      this._isOverDrop(
        dragNode.get('region').left + dragNode.get('region').width / 2,
        dragNode.get('region').top + dragNode.get('region').height / 2);

    if (this.currentDropUnderDrag) {
      this.handleDragEnter(dragNode, this.currentDropUnderDrag);
    }
    this.handleDragStart(dragNode, ev);
  },

  _handleDragDrag: function(dragNode, ev) {

//    var dragNode = ev.target;

    dragNode.numberOfTicksMoved++;
    var nodeRegion = dragNode.get('region');

    var dragNodeCenter = {
      x: nodeRegion.left + nodeRegion.width / 2,
      y: nodeRegion.top + nodeRegion.height / 2
    };

    var drop = this._isOverDrop(dragNodeCenter.x, dragNodeCenter.y);

    if (drop) {
      if (!this.currentDropUnderDrag) {
        this._handleDragEnter(dragNode, drop);
        this.currentDropUnderDrag = drop;
      }
      else if (drop !== this.currentDropUnderDrag) {
        this._handleDragExit(dragNode, this.currentDropUnderDrag);
        this._handleDragEnter(dragNode, drop);
        this.currentDropUnderDrag = drop;
      }
    }

    else {
      if (this.currentDropUnderDrag) {
        this._handleDragExit(dragNode, this.currentDropUnderDrag);
      }
      this.currentDropUnderDrag = undefined;
    }

    // If scrolling is enabled...
    if (this.enableDragScrolling) {
      var clientRect = dragNode.getDOMNode().getBoundingClientRect();
      var top = clientRect.top;
      var bottom = clientRect.bottom;

      // if the drag is near one edge of the screen...
      if (top < SCROLL_BUFFER) {
        if (this._scrollingDirection !== "UP") {
          // scroll up
          this._scrollingDirection = "UP";
          this._startScroll(-SCROLL_DIST);
        }
      }
      else if (window.innerHeight - bottom < SCROLL_BUFFER) {
        if (this._scrollingDirection !== "DOWN") {
          // scroll down
          this._scrollingDirection = "DOWN";
          this._startScroll(SCROLL_DIST);
        }
      }
      else {
        this._endScroll();
      }
    }

    this.handleDragDrag(dragNode, ev);
  },

  /** Start scrolling the page, dy pixels every SCROLL_DT milliseconds. */
  _startScroll: function(dy) {
    window.scroll(0, window.pageYOffset + dy);
    // clear any old scroll actions...
    clearTimeout(this.scrollTimeout);
    this.scrollTimeout = setTimeout(function() {
      this._startScroll(dy);
    }.bind(this), SCROLL_DT);
  },

  /** End the current scroll. */
  _endScroll: function() {
    clearTimeout(this.scrollTimeout);
    this._scrollingDirection = null;
  },

  /**
   * Handle a drag:end event. */
  _handleDragEnd: function(dragNode, ev, callback) {
    this._scrollingDirection = null;
    clearTimeout(this.scrollTimeout);
//    var dragNode = ev.target.get('node');
    dragNode.removeClass('dragging');
    if (dragNode._qm && typeof(dragNode._qm.setDraggingUI) === 'function') {
      dragNode._qm.setDraggingUI(false);
    }

    var numCalls = 0;
    function collectorCallback() {
      if (++numCalls === 2) {
        if (callback) {
          callback();
        }
      }
    }

    var nodeRegion = dragNode.get('region');

    var dragNodeCenter = {
      x: nodeRegion.left + nodeRegion.width / 2,
      y: nodeRegion.top + nodeRegion.height / 2
    };

    var drop = this._isOverDrop(dragNodeCenter.x, dragNodeCenter.y);

    if (drop) {
      this._handleDropHit(dragNode, drop, collectorCallback);
    }
    else {
      this._handleDropMiss(dragNode, collectorCallback);
    }

    this.handleDragEnd(dragNode, ev, collectorCallback);

    // Sorry this is a hack but needs to be here for 16.0 release for PlacingStickers
    if (this.handleDragEndWithConfig) {
      this.handleDragEndWithConfig({node: dragNode, keyEvent: false});
    }

    dragNode.numberOfTicksMoved = 0;
    this.currentDropUnderDrag = undefined;

  },

  /**
   * Intermediate handler for a drag:drophit event.
   * Can be used to route this event to different handlers if this is desired.
   * @protected
   */
  _handleDropHit: function(drag, drop, callback) {
    this.resetZIndices(drag);
    this.handleDropHit(drag, drop, callback);
    if (drag.currentPort) {
      drag.currentPort.occupant = null;
    }
    drag.currentPort = drop;
    drop.occupant = drag;


    if (drag._qm && typeof(drag._qm.setDraggingUI) === 'function') {
      drag._qm.setDraggingUI(false);
    }
    drag.removeClass('dragging');
  },

  /**
   * Intermediate handler for a drag:dropmiss event.
   * Can be used to route this event to different handlers if this is desired.
   * @protected
   */
  _handleDropMiss: function(drag, callback) {
    if (drag._qm && typeof(drag._qm.setDraggingUI) === 'function') {
      drag._qm.setDraggingUI(false);
    }
    drag.removeClass('dragging');
    this.handleDropMiss(drag, callback);
  },

  /**
   * Intermediate handler for the drag:enter event.
   * Can be used to route this event to different handlers if this is desired.
   * @protected
   */
  _handleDragEnter: function(drag, drop) {
    this.handleDragEnter(drag, drop);
  },

  /**
   * Intermediate handler for the drag:over event.
   * Can be used to route this event to different handlers if this is desired.
   * @protected
   */
  _handleDragOver: function(drag, drop) {
    this.handleDragOver(drag, drop);
  },

  /**
   * Intermediate handler for the drag:exit event.
   * Can be used to route this event to different handlers if this is desired.
   * @protected
   */
  _handleDragExit: function(drag, drop) {
    this.handleDragExit(drag, drop);
  },

  /**
   * Handler for the event that happens when click-to-move is enabled, and the
   * user has clicked a drag to select it.
   */
  _handleClickToMoveSelect: function(drag, suppressFocusEvent) {

    // Hacky fix here, I'd love to clean this up.  On mobile devices, this call to
    // .focus() brings up the mobile keyboard, so in the app where there is no
    // keyboard, it causes the app to crash silently.  This temp fix will be especially
    // problematic for touchscreen laptops :(
    if (!Y.UA.touchEnabled && !suppressFocusEvent) {
      drag.focus();
    }
    drag.removeClass('dragging');
    drag.addClass('selected');
    if (drag._qm && typeof(drag._qm.setSelectedUI) === 'function') {
      drag._qm.setSelectedUI(true);
    }
    if (drag._qm && typeof(drag._qm.setDraggingUI) === 'function') {
      drag._qm.setDraggingUI(false);
    }
    drag.ancestor('.dragAndDropContainer').addClass('clickToMoveMode');
    this.handleClickToMoveSelect(drag);
  },

  /**
   * Handler for the event that happens when click-to-move is enabled, and the
   * user has clicked a drag to select it.
   */
  handleClickToMoveSelect: function(drag) { },

  /**
   * Handler for the event that happens when click-to-move is enabled, and a
   * selected node becomes deselected.
   */
  _handleClickToMoveDeselect: function(drag) {
    if (drag && drag.getDOMNode()) {
      drag.blur();
      drag.ancestor('.dragAndDropContainer').removeClass('clickToMoveMode');
      drag.removeClass('selected');
      drag.removeClass('dragging');
      if (drag._qm && typeof(drag._qm.setSelectedUI) === 'function') {
        drag._qm.setSelectedUI(false);
      }
      if (drag._qm && typeof(drag._qm.setFocusUI) === 'function') {
        drag._qm.setFocusUI(false);
      }
      this.handleClickToMoveDeselect(drag);
    }
  },

  /**
   * Handler for the event that happens when click-to-move is enabled, and a
   * selected node becomes deselected.
   */
  handleClickToMoveDeselect: function(drag) {},

  /**
   * Handler for the event that happens when click-to-move is enabled, user has
   * clicked on a drag, and their mouse moves.
   * NOTE: in this handler, we are in click-to-move mode, so the position of the
   *       drag does not change as the mouse moves. Use the x and y parameters
   *       for the mouse position (in page coordinates).
   * @abstract
   */
  handleClickAndMove: function(drag, x, y) {},

  /**
   * Handler for the event that happens when click-to-move is enabled, user has
   * clicked on a drag, and then has clicked in a valid drop slot.
   * NOTE: (x, y) are in page coordinates.
   * @abstract
   */
  handleClickAndDropHit: function(drag, drop, x, y, callback) {
    if (callback) {
      callback();
    }
  },

  /**
   * Intermediate handler for the click-and-drop event.
   * @protected
   */
  _handleClickAndDropHit: function(drag, drop, x, y, callback) {
    drag.removeClass('selected');
    drag.removeClass('dragging');
    this.resetZIndices(drag);

    if (drag._qm && typeof(drag._qm.setSelectedUI) === 'function') {
      drag._qm.setSelectedUI(false);
    }
    if (drop) {
      this.handleClickAndDropHit(drag, drop, x, y, callback);
    }
    this._handleClickToMoveDeselect(drag);
  },

  // --------------------------------------------------------------------------
  // Keyboard handlers
  // --------------------------------------------------------------------------

  /** @override */
  _defaultArrowKeyDownHandler: function(ev, moveCallback) {

    var dragNode = this.focusedNode || Y.one('.selected');

    if (dragNode) {
      ev.preventDefault();

      if (this.firstArrowPress) {
        this.firstArrowPress = false;
        this._handleDragStart(dragNode, ev);
      }
      // Execute moveCallback before handleDragDrag, since handleDragDrag queries node's
      // position and assumes that the returned coordinates are the updated coordinates.
      // See bug 74838.
      moveCallback(ev);
      this._handleDragDrag(dragNode, ev);
      this.defaultArrowKeyDownAction(ev, function() {});
    }
  },
  /** @override */
  focusHandler: function(focusNode, ev) {

    // Don't allow focus on a moving tile. case 76527 -rlaber
    if (ev.target.ancestor('.' + Q.DragAndDropBase.MOVING_CLASS, true)) {
      ev.halt(true);
      return false;
    }

    if (Y.UA.android || Y.UA.ios) { return; }
    if (focusNode === this.focusedNode) { return; }

    // A node can be selected without being in focus.
    if (Y.one('.selected')) {
      this.blurHandler(Y.one('.selected'));
    }

    this.focusedNode = focusNode;
    focusNode.numberOfTicksMoved = 0;
    if (this.enableClickToMove) {
      this.setupClickToMove(focusNode, true);
    }
    if (focusNode._qm && typeof(focusNode._qm.setFocusUI) === 'function') {
      focusNode._qm.setFocusUI(true);
    }
  },
  /** @override */
  blurHandler: function(blurNode, ev) {
    if (this.suppressNextBlur) {
      ev.halt(true);
      this.suppressNextBlur = false;
      return;
    }
    if (Y.UA.android || Y.UA.ios) { return; }

    // Case 76637: As far as I can tell, the only way a node can be blurred
    // while a key is being held down is by clicking somewhere else, effectively
    // interrupting the keyboard drag event.  In this case, the blur node
    // should return to wherever it is supposed to go.  -rlaber
    if (this.currentKeysDown &&
      (this.currentKeysDown.length > 1 ||
      (Y.Lang.isValue(this.currentKeysDown[0]) && this.currentKeysDown[0] !== 9)))
    {
      this._isKeyEvent = false;
      this.currentKeysDown = [];
      this._handleDragEnd(blurNode, ev);
    }

    if (blurNode === this.focusedNode) {
      this._handleClickToMoveDeselect(blurNode);
      this.focusedNode = null;
    }
    if (blurNode._qm && typeof(blurNode._qm.setFocusUI) === 'function') {
      blurNode._qm.setFocusUI(false);
    }
    if (blurNode._qm && typeof(blurNode._qm.setSelectedUI) === 'function') {
      blurNode._qm.setSelectedUI(false);
    }
  },

  /** @override */
  upArrowKeyDownHandler: function(ev) {
    var node = this.focusedNode || Y.one('.selected');
    var nodeRegion = node.get('region');
    var containerRegion = this.dragAndDropContainer.get('region');
    node.setXY([nodeRegion.left, Math.max(nodeRegion.top - DISTANCE_PER_KEYPRESS, containerRegion.top)]);
  },
  /** @override */
  downArrowKeyDownHandler: function(ev) {
    var node = this.focusedNode || Y.one('.selected');
    var nodeRegion = node.get('region');
    var containerRegion = this.dragAndDropContainer.get('region');
    node.setXY([nodeRegion.left, Math.min(containerRegion.bottom - nodeRegion.height, nodeRegion.top + DISTANCE_PER_KEYPRESS)]);
  },
  /** @override */
  leftArrowKeyDownHandler: function(ev) {
    var node = this.focusedNode || Y.one('.selected');
    var nodeRegion = node.get('region');
    var containerRegion = this.dragAndDropContainer.get('region');
    node.setXY([Math.max(nodeRegion.left - DISTANCE_PER_KEYPRESS, containerRegion.left), nodeRegion.top]);
  },
  /** @override */
  rightArrowKeyDownHandler: function(ev) {
    var node = this.focusedNode || Y.one('.selected');
    var nodeRegion = node.get('region');
    var containerRegion = this.dragAndDropContainer.get('region');
    node.setXY([Math.min(nodeRegion.left + DISTANCE_PER_KEYPRESS, containerRegion.right - nodeRegion.width), nodeRegion.top]);
  },




  /**
   * Handler for the event that happens when click-to-move is enabled, user has
   * clicked on a drag, and then has clicked in a valid drop slot.
   * NOTE: (x, y) are in page coordinates.
   * @abstract
   */
  handleClickAndDropMiss: function(drag, x, y, callback) {},

  /**
   * Intermediate handler for the click-and-drop event.
   * @protected
   */
  _handleClickAndDropMiss: function(drag, x, y, callback) {
    drag.removeClass('selected');
    drag.removeClass('dragging');
    this.resetZIndices(drag);

    if (drag._qm && typeof(drag._qm.setSelectedUI) === 'function') {
      drag._qm.setSelectedUI(false);
    }
    this.handleClickAndDropMiss(drag, x, y, callback);
    this._handleClickToMoveDeselect(drag);
  },

  /**
   * Utility method which resets the z-index of each draggable item to reflect how
   * recently each one has been placed.
   */
  resetZIndices: function(newTop) {
    var oldIndex = this.zStack.indexOf(newTop);
    this.zStack.splice(oldIndex, 1);
    this.zStack.push(newTop);

    for (var i = 0; i < this.zStack.length; i++) {
      this.zStack[i].setStyle('zIndex', BASE_Z_INDEX + i);
    }
  },
  /**
   * Given two rectangles, returns the area of their intersection region.
   */
  intersectArea: function(r1, r2) {
    var dx = Math.max(0, Math.min(r1.left + r1.width, r2.left + r2.width) - Math.max(r1.left, r2.left));
    var dy = Math.max(0, Math.min(r1.top + r1.height, r2.top + r2.height) - Math.max(r1.top, r2.top));
    return dx * dy;
  },

  /** @override */
  ignoreTabPress: function(ev) {
    return this.dragAndDropContainer.one('.dragging');
  },

  /**
   * Utility method which manually checks if a point (x, y) in page coordinates
   * is in any drops. If the point is over a drop, that drop will be returned.
   * Otherwise, null will be returned.
   */
  _isOverDrop: function(x, y) {
    var target = null;
    Y.Array.some(this._drops, function(drop) {
      var dropNode = drop.get('node');
      var region = dropNode.get('region');
      if (x > region.left && x < region.right
        && y > region.top && y < region.bottom)
      {
        target = dropNode;
        return true;
      }
    });
    return target;
  },

  /**
   * Utility method which manually checks if a point (x, y) in page coordinates
   * is in any drags. If the point is over a drag, that drag will be returned.
   * Otherwise, null will be returned.
   */
  _isOverDrag: function(x, y) {
    var target = null;
    var container = Y.one(this._dragDelegate.get('container'));
    var drags = container.all('.' + Q.DragAndDropBase.DRAG_SELECTOR_CLASS);

    // Account for moving drags that temporarily do not have the DRAG_SELECTOR_CLASS.
    var movingDrag = container.one('.' + Q.DragAndDropBase.MOVING_CLASS);
    if (movingDrag) {
      drags.push(movingDrag);
    }

    drags.some(function(drag) {
      var region = drag.get('region');
      if (x > region.left && x < region.right
        && y > region.top && y < region.bottom)
      {
        target = drag;
        return true;
      }
    });
    return target;
  },

  /**
   * Hide any node with class 'dummy'
   */
  hideDummyNode: function(dropSlot) {

    // After thinking about this, I'm not sure we really need to hide
    // anything, since presumably the drag node will be on top of (higher
    // z-index than) the dummy node.  I'll leave this here in case something
    // changes in the future.  -rlaber

    //if (dropSlot.one('.dummy')) {
    //  dropSlot.one('.dummy').setStyles({visibility: 'hidden', opacity: 0});
    //}
  },

/**
 * Show any node with class 'dummy'
 */
  showDummyNode: function(dropSlot) {
    if (dropSlot.one('.dummy')) {
      dropSlot.one('.dummy').setStyles({visibility: 'visible', opacity: 1});
    }
  }


},
{
  TRANSITION_TIME_MS: 500,
  DRAG_SELECTOR_CLASS: 'draggableElement',
  MOVING_CLASS: 'moving'    // class assigned to nodes when they are physically moving
});
