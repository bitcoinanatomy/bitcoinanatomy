module.exports = function(grunt) {

  // Project configuration.
  grunt.initConfig({
    meta: {
      version: '0.3.0',
    },
    lint: {
      files: ['src/*.js']
    },
    concat: {
      dist: {
        src: ['src/*.js'],
        dest: 'jquery.tiles.js'
      }
    },
    min: {
      dist: {
        src: ['<config:concat.dist.dest>'],
        dest: 'jquery.tiles.min.js'
      }
    },
    copy: {
      options: {
        flatten: true
      },
      dist: {
        src: ['jquery.tiles.min.js', 'lib/*.js'],
        dest: 'site/scripts/',
      }
    },
    compress: {
      zip: {
        files: {
          'site/jQuery-Tiles-0.3.0.zip': [ '<config:min.dist.dest>', '<config:concat.dist.dest>', 'lib/*.js' ]
        }
      }
    },
    watch: {
      files: ['src/*.js'],
      tasks: ['concat', 'min', 'copy']
    },
    jshint: {
      options: {
        curly: true,
        eqeqeq: true,
        immed: false,
        latedef: true,
        newcap: true,
        noarg: true,
        sub: true,
        undef: true,
        boss: true,
        eqnull: true,
        browser: true,
        loopfunc: true
      },
      globals: {
        jQuery: true
      }
    },
    uglify: {}
  });

  // Default task.
  grunt.registerTask('default', 'lint concat min copy compress');

  grunt.loadNpmTasks('grunt-contrib-compress');
  grunt.loadNpmTasks('grunt-contrib-copy');
};
