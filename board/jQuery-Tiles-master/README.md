[jQuery-Tiles](http://tiles.hackyon.com) - Image Tiling and Zooming
===================================================================

jQuery-Tiles is an image tiling and zooming library for really big images. It is a much simpler version of the tiling used in many mapping applications (such as Google Maps). As indicative in the name, this is a [jQuery](http://jquery.com) plugin.

Some features include:

* Lazy Loading - Tiled images are only loaded when they are viewable in the viewport, thereby reducing the time and bandwidth required when loading large images.
* Zoom and Drag - Support different levels of zooming for your tiled images, from thumbnail previews to high-resolution originals.
* Simple tiled image generation with the bash script ```generate.sh```.

This project is in Beta. Suggestions and contributions are encouraged.


Getting Started
--------------------------------------

### Generating the Tiled Images
The bash script, ```generate.sh``` simplifies the tile generation process. The script handles the tiling and directory structure of the generated tiles. 

1. Install [ImageMagick](http://www.imagemagick.org/script/binary-releases.php)
2. Move the source image, ```source.jpg``` to the same directory of ```generate.sh```
3. Run ```generate.sh``` with the desired zooms and tile size. For example, to generate 300x300 tiles at zooms 3 and 4, run ```./generate.sh -z '3 4' -t 300 source.jpg```
4. Tiled images will be generated under the ```tiles/``` directory

### Client-side JavaScript
To run jQuery-Tiles on a page, you need to include the [jQuery](http://jquery.com/) and [jQuery-UI](http://jqueryui.com/) dependencies:

```html
<script type="text/javascript" src="http://ajax.googleapis.com/ajax/libs/jquery/1.8.2/jquery.min.js"></script>
<script type="text/javascript" src="http://code.jquery.com/ui/1.9.0/jquery-ui.js"></script>

<script type="text/javascript" src="scripts/jquery.tiles.min.js"></script>
```

Simply select the viewport and initialize with options:

```javascript
$('.viewport').tiles({
  original: {
    width:  3264,                // Required - width of original image
    height: 2448,                // Required - height of original image
  },
  basePath: "images/pier/",      // Required - path containing the tiles/ directory
  loading: "images/loading.gif", // Optional - placeholder image for loading images
  zoom: 2                        // Optional - initial zoom level
});
```

Check out the source of the [demo](http://tiles.hackyon.com) at ```site/``` (see ```index.html```) for an example.


Build
--------------------------------------
The project is built with [Grunt](http://gruntjs.com/).

1. Go to the project directory (containing grunt.js)
2. ```npm install```
3. ```grunt```

When you run grunt, the source code under ```src/``` will be linted, minified, and copied to ```jquery.tiles.js```, and ```jquery.tiles.min.js```, and the ```site/``` directory. You may want to run ```grunt watch``` before you edit the source so changes will be automatically copied and packaged.


Contributions
--------------------------------------
Contributions are welcomed. There are no guidelines for contributions at this moment, but some guidelines may be set up in the future. If you want to contribute and need help understanding the code, don't hesitate to contact me.


License
--------------------------------------
The source is freely available under the terms of the MIT License. 

Feel free to download, modify, and use for personal or commercial projects. I would appreciate a pingback if you find the project useful, but it's certainly not required. 


Credits
--------------------------------------

Created by [Donald Lau](http://www.badassdon.com).

