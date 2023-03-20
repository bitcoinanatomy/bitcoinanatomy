/**
 * jQuery-Tiles v0.3.0
 *
 * Tiles takes care of loading and zooming of tiled images. This jQuery
 * plugin depends on jQuery and jQuery UI (draggable). The tiled images
 * may be generated on the server using the associated shell script.
 * 
 * Distributed under the terms of the MIT License.
 *
 * http://tiles.hackyon.com
 */
(function($) {
  
  var Layer = function(zoom, $viewport, config) {
    this.config = config;
    this.zoom = zoom;
    this.$viewport = $viewport;
    this.$layer = $('<div/>');

    this.width  = config.original.width  / zoom;
    this.height = config.original.height / zoom;
  };

  Layer.prototype.move = function(centerX, centerY) {
    // The centerX and centerY are interpreted as the coordinates of the 
    // original image and not of the current zoom.

    var viewportWidth  = this.$viewport.width();
    var viewportHeight = this.$viewport.height();

    var positionTop  = (centerY / this.zoom) - viewportHeight/2;
    var positionLeft = (centerX / this.zoom) - viewportWidth /2;

    // Be aware of bounds
    var maxLeft = -(viewportWidth - this.width);
    var maxTop  = -(viewportHeight - this.height);
    
    positionTop  = Math.max(0, Math.min(maxTop, positionTop));
    positionLeft = Math.max(0, Math.min(maxLeft, positionLeft));

    if (viewportWidth > this.width) {
      positionLeft = -(viewportWidth - this.width)/2;
    }
    if (viewportHeight > this.height) {
      positionTop = -(viewportHeight - this.height)/2;
    }

    this.$layer.css('top', -positionTop);
    this.$layer.css('left', -positionLeft);

    // Recalculate the center since it may have changed due to containment
    this.centerX = (positionLeft + viewportWidth /2) * this.zoom;
    this.centerY = (positionTop  + viewportHeight/2) * this.zoom;

    if (viewportWidth > this.width) {
      this.centerX = this.config.original.width/2;
    }
    if (viewportHeight > this.height) {
      this.centerY = this.config.original.height/2;
    }

    this._ondrag();
  };

  Layer.prototype.show = function() {
    this.$layer.css('z-index', 2);
    this.$layer.css('display', 'block');
  };

  Layer.prototype.hide = function() {
    this.$layer.css('z-index', 1);
    this.$layer.css('display', 'none');
  };

  Layer.prototype.resetContainment = function() {
    var $viewport = this.$viewport;
    var $layer = this.$layer;
    
    var offset = $viewport.offset();
    var width  = this.width;
    var height = this.height;

    var containment = [
      offset.left + $viewport.width() - width, 
      offset.top + $viewport.height() - height, 
      offset.left, 
      offset.top
    ];
    if ($viewport.width() > width) {
      containment[0] = offset.left + ($viewport.width() - width)/2;
      containment[2] = offset.left + ($viewport.width() - width)/2;
    }
    if ($viewport.height() > height) {
      containment[1] = offset.top + ($viewport.height() - height)/2;
      containment[3] = offset.top + ($viewport.height() - height)/2;
    }

    $layer.draggable('option', 'containment', containment);
  };

  Layer.prototype.load = function() {
    var $viewport = this.$viewport;
    var $layer = this.$layer;
    var zoom   = this.zoom;
    var config = this.config;

    var width  = this.width;
    var height = this.height;

    var tileSize = config.tileSize;

    $layer.css('position', 'absolute');

    var cols = Math.ceil(width  / tileSize);
    var rows = Math.ceil(height / tileSize);

    for (var r = 1; r <= rows; r++) {
      var $row = $('<div/>');
      for (var c = 1; c <= cols; c++) {
        var $tile = $('<div/>');
        $tile.css({
          'width':  tileSize,
          'height': tileSize,
          'float': 'left',
          'text-align': 'left',
          'vertical-align': 'top'
        });

        if (config.loading) {
          $tile.css('background', 'url(' + config.loading + ') center center no-repeat');
        }

        var $image = $('<img/>');
        if (r !== rows) {
          $image.attr('height', tileSize);
        } else {
          $image.attr('height', height % tileSize);
        }
        
        if (c !== cols) {
          $image.attr('width', tileSize);
        } else {
          $image.attr('width', width % tileSize);
        }

        var selector = ['tiles', zoom, c, r].join('-');
        $image.addClass(selector);

        $image.data('loaded', false);
        $image.data('src', config.basePath + 'tiles/' + zoom + '/' + c + '_' + r + '.jpg');
        $image.hide();

        $tile.append($image);
        $row.append($tile);
      }
      $row.css('width', cols * tileSize);
      $layer.append($row);
    }

    $viewport.append($layer);

    var layer = this;
    $layer.draggable({
      drag: function() { layer._ondrag(); }
    });

    this.resetContainment();
    this._ondrag();

    this.hide();
  };

  Layer.prototype._ondrag = function() {
    var tileSize = this.config.tileSize;
    var position = this.$layer.position();

    var startCol = Math.floor(-position.left / tileSize)+1;
    var endCol   = Math.ceil((-position.left + this.$viewport.width()) / tileSize);

    var startRow = Math.floor(-position.top / tileSize)+1;
    var endRow   = Math.ceil((-position.top + this.$viewport.height()) / tileSize);

    for (var c = startCol; c <= endCol; c++) {
      for (var r = startRow; r <= endRow; r++) {
        var selector= ['.tiles', this.zoom, c, r].join('-');
        var $image = this.$layer.find(selector);

        if (!$image.data('loaded')) {
          $image.attr('src', $image.data('src'));
          $image.data('loaded', true);
          $image.load(function() {
            $(this).fadeIn(250);
          });
        }
      }
    }

    this.centerX = (-position.left + this.$viewport.width()/2)  * this.zoom;
    this.centerY = (-position.top  + this.$viewport.height()/2) * this.zoom;
  };


  var DummyLayer = function(zoom, $viewport, config) {
    this.config = config;
    this.zoom = zoom;
    this.$viewport = $viewport;

    var $layer = $('<div/>');
    $viewport.children().each(function(index) {
      $(this).detach().appendTo($layer);
    }); 
    this.$layer = $layer;

    this.centerX = 0;
    this.centerY = 0;
  };

  DummyLayer.prototype.show = function() {
    this.$layer.css('z-index', 2);
    this.$layer.css('display', 'block');
  };

  DummyLayer.prototype.hide = function() {
    this.$layer.css('z-index', 1);
    this.$layer.css('display', 'none');
  };

  DummyLayer.prototype.load = function() { 
    this.$viewport.append(this.$layer);
  };

  DummyLayer.prototype.move = function(centerX, centerY) { 
    this.centerX = centerX;
    this.centerY = centerY;
  };


  var methods = {
    init : function(options) {
      var config = $.extend({
        original: { width: null, height: null },
        tileSize: 500,
        basePath: '',
        loading: '',
        zoom: 0,
        no0zoom: false
      }, options);

      // Basic sanitation check
      if (typeof config.original.width  !== 'number' ||
          typeof config.original.height !== 'number') {
        throw 'Missing required fields original.width and original.height.';
      }
      if (config.original.width <= 0 || config.original.height <= 0) {
        throw 'Both original.width and original.height must be > 0';
      }

      // The basePath needs to end with a / if it is not empty
      var basePath = $.trim(config.basePath);
      if (basePath) {
        if (basePath.indexOf('/', basePath.length-1) === -1) {
          basePath += '/';
        }
      }
      config.basePath = basePath;

      this.data('config', config);

      return this.each(function() {
        var $this = $(this);
        $this.css('position', 'relative');
        $this.css('overflow', 'hidden');

        var layers = { };

        if (!config.no0zoom) {
          // Load the original layer to save the HTML content that 
          // was inside viewport
          layers[0] = new DummyLayer(0, $this, config);
          layers[0].load();
          layers[0].hide();
        } else if (config.zoom === 0) {
          throw "You must specify a non-zero zoom if no0zoom is true";
        }
        
        var zoom = config.zoom;
        if (zoom !== 0) {
          layers[zoom] = new Layer(zoom, $this, config);
          layers[zoom].load();
        }
        layers[zoom].show();

        $this.data('layers', layers);
        $this.data('zoom', zoom);

        // Capture resize and reposition events
        var recompute = function() {
          $.each(layers, function(zoom, layer) {
            if (zoom === 0) {
              return; // No need to do anything for the DummyLayer
            }
            layer.resetContainment(); 
            layer._ondrag();
          });
        };

        // Recomputation is expensive so delay until the final event
        var timeout = null;
        $this.bind('resize reposition', function() {
          if (timeout) {
            clearTimeout(timeout);
          }
          timeout = setTimeout(recompute, 300);
        });
      });
    },
    zoom: function(factor) {
      var config = this.data('config');

      return this.each(function() {
        var $this = $(this);
        
        var zoom = $this.data('zoom');
        if (zoom === factor) {
          return;
        }

        var layers = $this.data('layers');

        var centerX = layers[zoom].centerX;
        var centerY = layers[zoom].centerY;
        layers[zoom].hide();
        zoom = factor;

        if (!layers[zoom]) {
          layers[zoom] = new Layer(zoom, $this, config);
          layers[zoom].load();
        }
        layers[zoom].show();
        layers[zoom].move(centerX, centerY);

        $this.data('layers', layers);
        $this.data('zoom', zoom);
      });
    },
    move: function(centerX, centerY) {
      var config = this.data('config');

      return this.each(function() {
        var $this = $(this);

        var zoom   = $this.data('zoom');
        var layers = $this.data('layers');

        layers[zoom].move(centerX*zoom, centerY*zoom);
      });
    },
    center: function() {
      var config = this.data('config');

      return this.each(function() {
        var $this = $(this);

        var zoom   = $this.data('zoom');
        var layers = $this.data('layers');

        layers[zoom].move(config.original.width/2, config.original.height/2);
      });
    }
  };

  $.fn.tiles = function (method) {
    if (methods[method]) {
      return methods[method].apply(this, Array.prototype.slice.call(arguments, 1));
    } else if (typeof method === 'object' || !method) {
      return methods.init.apply(this, arguments);
    } else {
      $.error ('No such method: ' + method);
    }
  };
  
})(jQuery);
