#!/bin/bash
# jQuery-Tiles v0.3.0 (generate.sh)
# 
# Generates tiled images for jQuery-Tiles. The tiled images will be 
# generated under the tiles/ directory.
#

# TODO: More robust checks on input

# Basic usage command
function usage() {
  echo "jQuery-Tiles v0.3.0 (generate.sh)"
  echo
  echo "This shell script generates the tiled images for jQuery-Tiles (using the 'convert' command from ImageMagick). The tiled images will be generated under the tiles/ folder located in the same directory as the input image."
  echo
  echo "Usage: ./generate.sh [-hzt] file"
  echo
  echo "Options:"
  echo "  -z, --zooms       zoom levels to generate (ex. '1 2 3 4')"
  echo "  -t, --tile-size   size of the square tiles in pixels (default is 500)"
  echo
  echo "  -h, --help        print this help message"
  echo
}

# Sanity check for ImageMagick (convert)
if ! command -v convert >/dev/null 2>&1; then
  echo
  echo "Required 'convert' command not found. "
  echo 
  echo "Please make sure ImageMagick is installed and the 'convert' command is in the path. See the documentation (http://tiles.hackyon.com) for more details."
  echo
  exit 1
fi

# Parameters
TILESIZE=500
ZOOMS="1"
FILE=""

while [ "$1" != "" ]; do
  case $1 in
    -z | --zooms )          shift
                            ZOOMS=$1
                            ;;
    -t | --tile-size )      shift
                            TILESIZE=$1
                            ;;
    -h | --help )           usage
                            exit
                            ;;
    * )                     FILE=$1
                            ;;
  esac
  shift
done

DIR=$(dirname "$FILE")
FILENAME=$(basename "$FILE")

# Various other sanity and permission checks
if [ ! -e "$FILE" ]; then
  echo "No input file. See help (./generate.sh -h) for more details."
  exit 1
fi

if ! [[ -r $DIR && -w $DIR ]]; then
  echo "No permission to generate tiles in target directory (directory of file)."
  exit 1
fi

if ! [ -r $FILE ]; then
  echo "No permission to read input file."
  exit 1
fi

# Change into the arget directory
cd $DIR

# Print out dimensions if identify is found
if command -v identify >/dev/null 2>&1; then
  MSG=$(identify -format "original: { width: %w, height: %h }" $FILENAME)
  if [ "$TILESIZE" != "500" ]; then
    MSG=$MSG", tileSize: $TILESIZE"
  fi
  echo "jQuery-Tiles (Javascript):"
  echo "  .tiles({ $MSG })"
  echo
fi

# The tiles will be generated under the "tiles" directory
if [ ! -d "tiles/" ]; then
  mkdir tiles
fi

for i in ${ZOOMS[@]}; do
  if [ -d "tiles/${i}" ]; then
    echo -n "Tiles for zoom ${i} (tiles/${i}) already exists, recreate it [Y/n]? "
    read KEY
    if [[ "$KEY" != "Y" && "$KEY" != "y" ]]; then
      echo "Skipping zoom ${i}..."
      continue
    fi
    rm -rf "tiles/${i}"
  fi
  mkdir "tiles/${i}"
  RESIZE=$(echo "scale=15;1/${i}*100" | bc)
  convert ${FILENAME} -resize ${RESIZE}% -crop ${TILESIZE}x${TILESIZE} -strip -set filename:tile "%[fx:page.x/${TILESIZE}+1]_%[fx:page.y/${TILESIZE}+1]" +repage +adjoin "tiles/${i}/%[filename:tile].jpg"
done

echo
echo "The tiles/ folder can be found in $DIR/"

