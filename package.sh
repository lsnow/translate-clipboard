#!/bin/bash
include_files=(
src
stylesheet.css
extension.js
metadata.json
prefs.js
prefs.css
LICENSE
schemas
icons
)

args=""
for include_file in "${include_files[@]}"; do
  if [ -e "$include_file" ]; then
    args="${args} ${include_file}"
  fi
done

if [[ -n $1 ]]; then
  package_name=$1
else
  package_name=$(date +'%Y%m%d%H%M%S')
fi

args="-r ${package_name}.zip ${args}"

zip ${args}
