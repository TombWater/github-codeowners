#! /bin/bash

fg=${1:-black}
bg=${2:-transparent}

css="svg { stroke: $fg; fill: $fg; } svg path { stroke: $fg; fill: $fg; }"

for s in 16 32 48 128; do
  m=0 # $(($s/16))
  w=$(($s-$m-$m))
  rsvg-convert icon.svg -o icon_${s}.png -w $w --page-width $s --page-height $s --top $m --left $m -b $bg --stylesheet <(echo "$css") 
done

