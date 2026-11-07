# Keys pure #00FF00 out of a crop of a sheet. Natural greens survive because we key on
# distance from *saturated* green, then unmix edge pixels so no green fringe remains.
import subprocess, sys, math
src, x, y, w, h, out = sys.argv[1], *map(int, sys.argv[2:6]), sys.argv[6]
raw = subprocess.run(['ffmpeg','-loglevel','error','-i',src,'-vf',f'crop={w}:{h}:{x}:{y}','-f','rawvideo','-pix_fmt','rgb24','-'], capture_output=True, check=True).stdout
rgb = bytearray(w*h*3); al = bytearray(w*h)
lo, hi = 45.0, 120.0
for i in range(w*h):
    r, g, b = raw[i*3], raw[i*3+1], raw[i*3+2]
    d = math.sqrt(r*r + (255-g)*(255-g) + b*b)
    a = min(1.0, max(0.0, (d-lo)/(hi-lo))); a = a*a*(3-2*a)
    if a > 0.01:
        # unmix: c = a*fg + (1-a)*bg  ->  fg
        fr = r/a; fg = (g - (1-a)*255)/a; fb = b/a
        fg = min(fg, max(fr, fb)*1.15 + 20)  # despill
        rgb[i*3] = max(0, min(255, int(fr))); rgb[i*3+1] = max(0, min(255, int(fg))); rgb[i*3+2] = max(0, min(255, int(fb)))
    al[i] = int(a*255)
def enc(data, fmt, path, q):
    subprocess.run(['ffmpeg','-loglevel','error','-y','-f','rawvideo','-pix_fmt',fmt,'-s',f'{w}x{h}','-i','-','-q:v',str(q),path], input=bytes(data), check=True)
enc(rgb, 'rgb24', out + '.jpg', 2); enc(al, 'gray', out + '_a.jpg', 3)
