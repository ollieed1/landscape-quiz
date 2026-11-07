/* ============================================================
   LAYERED SCENE: five photographic layers locked in place.
   Each layer has its own states; they crossfade independently,
   so the change rolls through the scene part by part.
   rect = where the layer sits in the square scene [x, y, w, h], y down.
   stops = [mood, state index]; between stops the two states blend.
   ============================================================ */
const LAYERS = {
  sky:  { rect: [-.02, -.04, 1.04, .7],                 states: ['sky_0', 'sky_2', 'sky_3', 'sky_4', 'sky_5', 'sky_6', 'sky_7', 'sky_8'], alpha: false,
          // hell → red → storm → overcast → mostly cloudy (start) → partly cloudy → few clouds → clear
          stops: [[0, 3], [.1, 2], [.27, 1], [.4, 4], [.5, 5], [.66, 6], [.8, 0], [.95, 7]] },
  mtn:  { rect: [.36, .22, .5, .5],            states: ['mtn_0', 'mtn_2', 'mtn_3'], alpha: true,
          stops: [[.02, 2], [.1, 1], [.36, 1], [.56, 0]] },
  mid:  { rect: [-.1, .2, 1.2, .9],        states: ['mid_0', 'mid_1', 'mid_2', 'mid_3'], alpha: true,
          stops: [[.05, 3], [.2, 2], [.36, 1], [.52, 0]] },
  fg:   { rect: [-.05, .52, 1.1, .62],              states: ['fg_0', 'fg_1', 'fg_2', 'fg_3'], alpha: false,
          stops: [[.01, 3], [.07, 2], [.2, 2], [.36, 1], [.52, 0]] },
  tree: { rect: [-.13, .14, .6, .6],           states: ['tree_0', 'tree_1', 'tree_2', 'tree_3'], alpha: true,
          stops: [[.08, 3], [.22, 2], [.36, 1], [.5, 0]] },
};
const ASSETS = { /*%%ASSETS%%*/ };

// global light per mood: exposure, tint, saturation — darker as it gets worse
const GRADE = [
  { m: 0.00, exp: .42, tint: [1.0, .78, .72], sat: .85 },
  { m: 0.12, exp: .52, tint: [1.3, .58, .42], sat: .9 },
  { m: 0.27, exp: .6,  tint: [.95, .95, .96], sat: .62 },
  { m: 0.40, exp: .78, tint: [.95, .97, 1.0], sat: .78 },
  { m: 0.50, exp: .9,  tint: [1, 1, 1], sat: .9 },     // starting point: neutral midday, quite cloudy
  { m: 0.75, exp: 1.0, tint: [1, 1, 1], sat: 1.0 },
  { m: 1.00, exp: 1.1, tint: [1.02, 1.02, 1], sat: 1.1 },
];
function stateAt(stops, m) {
  if (m <= stops[0][0]) return [stops[0][1], stops[0][1], 0];
  for (let i = 0; i < stops.length - 1; i++) {
    const [m0, s0] = stops[i], [m1, s1] = stops[i + 1];
    if (m <= m1) { const t = (m - m0) / (m1 - m0); return [s0, s1, t * t * (3 - 2 * t)]; }
  }
  const s = stops[stops.length - 1][1]; return [s, s, 0];
}
function gradeAt(m) {
  let i = 0; while (i < GRADE.length - 2 && m > GRADE[i + 1].m) i++;
  const a = GRADE[i], b = GRADE[i + 1], t = clamp((m - a.m) / (b.m - a.m), 0, 1);
  return { exp: lerp(a.exp, b.exp, t), sat: lerp(a.sat, b.sat, t), tint: a.tint.map((v, k) => lerp(v, b.tint[k], t)) };
}

/* ============================================================
   WEBGL COMPOSITOR
   ============================================================ */
const panel = document.getElementById('lp'), canvas = document.getElementById('gl');
const gl = canvas.getContext('webgl', { antialias: false, premultipliedAlpha: false });
const VS = `attribute vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }`;
const FS = `
precision highp float;
uniform sampler2D tS0,tS1,tM0,tM1,tD0,tD1,tF0,tF1,tT0,tT1;
uniform float mS,mM,mD,mF,mT;
uniform vec4 rS,rM,rD,rF,rT;
uniform vec2 uRes;
uniform float uTime, uFlash, uExp, uSat, uDpr, uLava, uLeaves, uEmbers, uWind, uSun, uCloudSh;
uniform vec3 uTint;

float h21(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
vec2 h22(vec2 p){ return vec2(h21(p), h21(p+17.31)); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),u.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),u.x), u.y); }
float fbm(vec2 p){ float a=.5,s=0.; for(int i=0;i<5;i++){ s+=a*vn(p); p=mat2(1.6,1.2,-1.2,1.6)*p; a*=.5; } return s; }

vec2 coverUV(vec2 fc){
  vec2 uv = fc/uRes; uv.y = 1.-uv.y;
  float ar = uRes.x/uRes.y;
  if(ar>1.){ uv.y = (uv.y-.5)/ar + .55; } else { uv.x = (uv.x-.5)*ar + .5; }
  return uv;
}
// sample a layer: blend of its two active states, premultiplied
// cloud shadows: one moving cloud field, projected onto the ground plane so patches shrink with distance
const float HZ = .585;
float cloudField(vec2 p){ return smoothstep(.42,.66, fbm(p + vec2(uTime*.035, uTime*.012))); }
float groundShadow(vec2 uv){
  float z = 1./max(uv.y-HZ, .012);
  vec2 g = vec2((uv.x-.5)*z, z)*vec2(.55,.35);
  return cloudField(g*.9);
}
float farShadow(vec2 uv){ return cloudField(vec2(uv.x*3.2, uv.y*7.)+vec2(11.,3.)); }
vec4 L(sampler2D a, sampler2D b, float m, vec4 r, vec2 uv, vec2 d, bool opaque){
  vec2 l = (uv-r.xy)/r.zw + d;
  if(l.x<0.||l.y<0.||l.x>1.||l.y>1.) return vec4(0.);
  vec4 ca = texture2D(a,l), cb = texture2D(b,l);
  if(opaque){ ca.a = 1.; cb.a = 1.; }
  vec3 c = mix(ca.rgb*ca.a, cb.rgb*cb.a, m);
  return vec4(c, mix(ca.a, cb.a, m));
}
vec3 over(vec3 dst, vec4 src){ return src.rgb + dst*(1.-src.a); }
float hotMask(vec3 c){ return smoothstep(.12,.45,c.r-c.g*1.05)*smoothstep(.35,.8,c.r); }

float particles(vec2 uv, float sc, float T, vec2 vel, float sway, float sz, float seed, out vec3 tt){
  float acc = 0.; tt = vec3(0.);
  vec2 p = uv*sc - vel*T; vec2 id = floor(p);
  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){
    vec2 c = id+vec2(i,j); vec2 r = h22(c+seed);
    if(r.x>.55) continue;
    float r3 = h21(c+seed*3.1);
    vec2 pos = c+.5+(r-.5)*.8;
    pos.x += sin(T*(.6+1.6*r.y)+r.x*30.)*sway*(.4+1.2*r3) + sin(T*(2.3+r3)+r.y*11.)*sway*.25;
    pos.y += sin(T*(.4+.9*r3)+r.x*17.)*.35 + fract(r3*7.)*T*.15*(r.x-.3);   // some float, some drop
    vec2 q = p-pos; float a = T*(.4+3.*r3)*(r.y>.5?1.:-1.)+r.x*6.;
    q = mat2(cos(a),sin(a),-sin(a),cos(a))*q; q.y *= 1.+2.2*abs(sin(a*(.4+r.y)));
    float s2 = sz*(.55+.9*r3);
    float m = smoothstep(s2, s2*.4, length(q));
    acc = max(acc,m); tt = mix(tt, vec3(r.x,r.y,h21(c+3.)), m);
  }
  return acc;
}

void main(){
  vec2 uv = coverUV(gl_FragCoord.xy);
  float T = uTime;

  // ---- sky (clouds churn slowly) ----
  vec2 dS = (vec2(fbm(uv*vec2(3.,5.)+vec2(T*.02,0.)), fbm(uv*vec2(3.,5.)+vec2(5.2,T*.015)))-.5)*.012;
  vec3 col = L(tS0,tS1,mS,rS, uv, dS, true).rgb;
  // below the sky plate: continue its horizon colour
  vec3 hz = mix(texture2D(tS0, vec2(.5,.97)).rgb, texture2D(tS1, vec2(.5,.97)).rgb, mS);
  col = mix(col, hz, smoothstep(.6,.64,uv.y));
  col += uFlash*vec3(.5,.55,.75)*(.5+fbm(uv*4.))*smoothstep(.65,.2,uv.y);

  // ---- mountains: pushed back with haze ----
  vec4 mt = L(tM0,tM1,mM,rM, uv, vec2(0.), false);
  float mHot = hotMask(mt.a>0. ? mt.rgb/mt.a : vec3(0.));
  mt.rgb = mix(mt.rgb, hz*mt.a, mix(.3, .18, uSun)*(1.-mHot));
  mt.rgb *= 1.-.42*uCloudSh*farShadow(uv);
  // light wrap: sky light bleeds around the mountain edges
  float mA = 0.;
  for(int i=0;i<6;i++){ float a = float(i)*1.047; mA += L(tM0,tM1,mM,rM, uv+vec2(cos(a),sin(a))*.006, vec2(0.), false).a; }
  mt.rgb += col*mt.a*(1.-mA/6.)*.55*(.4+.6*uSun);
  col = over(col, mt);
  float hot = mHot*mt.a;

  // ---- midground hills ----
  vec4 md = L(tD0,tD1,mD,rD, uv, vec2(0.), false);
  md.rgb = mix(md.rgb, hz*md.a, .08);
  md.rgb *= 1.-.45*uCloudSh*groundShadow(uv);
  col = over(col, md);

  // ---- foreground meadow + path: wind through the grass, fades in below the hills ----
  float g = clamp((uv.y-.6)/.4, 0., 1.);
  float gust = fbm(vec2(uv.x*2.-T*.35*uWind, uv.y*3.));
  vec2 dF = vec2(sin(uv.y*220.+T*3.*uWind+gust*8.)*.0011*uWind*g*(.4+gust) + (gust-.45)*.004*uWind*g, 0.);
  vec4 fg = L(tF0,tF1,mF,rF, uv, dF, true);
  fg *= smoothstep(.6,.7,uv.y);
  float fHot = hotMask(fg.rgb);
  // heat shimmer over lava
  if(uLava>0.){ vec2 dh = (vec2(vn(uv*60.+vec2(0.,T*2.)), vn(uv*60.+vec2(9.,T*2.3)))-.5)*.004*uLava*fHot;
    fg = L(tF0,tF1,mF,rF, uv, dF+dh, true)*smoothstep(.6,.7,uv.y); }
  fg.rgb *= 1.-.45*uCloudSh*groundShadow(uv);
  col = over(col, fg);
  hot = max(hot, fHot*fg.a);

  // contact shadow under the tree (softer when the sun is out, the cast shadow takes over)
  vec2 cs = (uv-vec2(.152,.742))/vec2(.1,.016);
  col *= 1.-mix(.45,.3,uSun)*smoothstep(1.,0.,length(cs));
  // the tree's own shadow thrown across the meadow, sun behind-left
  if(uSun>0. && uv.y>.7){
    float base = .742, dy = uv.y-base;
    vec2 src = vec2(uv.x - dy*1.6, base - dy*3.2);
    float ts = L(tT0,tT1,mT,rT, src, vec2(0.), false).a;
    float ts2 = L(tT0,tT1,mT,rT, src+vec2(.008,.012), vec2(0.), false).a;
    col *= 1.-.42*uSun*mix(ts,ts2,.5)*smoothstep(.7,.76,uv.y);
  }

  // ---- tree: no single sway — gusts roll through, branches lag, leaves flutter on their own ----
  vec2 tl = (uv-rT.xy)/rT.zw;
  float hgt = pow(1.-clamp(tl.y,0.,1.),1.4);
  float tGust = fbm(vec2(tl.x*1.4 - T*.42, tl.y*1.1 + T*.13));           // a gust travelling across the crown
  float gust2 = fbm(vec2(tl.x*3.1 + 7. - T*.9, tl.y*2.7 - T*.31));       // smaller eddies
  float limb = sin(T*.83 + tl.x*2.3 + tGust*3.)*.0025 + sin(T*1.37 + tl.y*5.1 + 1.7)*.0014;
  float canopy = smoothstep(.8,.25,tl.y);
  float flutter = (vn(tl*42. + vec2(T*2.7, -T*1.9)) - .5) * .004 * canopy * (.5+gust2);
  vec2 dT = vec2((tGust-.45)*.014 + (gust2-.45)*.006 + limb, (gust2-.45)*.004)*uWind*hgt
          + vec2(flutter, flutter*.7)*(.4+uWind);
  vec4 tr = L(tT0,tT1,mT,rT, uv, dT, false);
  // sky light wraps the crown edges
  float tA = 0.;
  for(int i=0;i<6;i++){ float a = float(i)*1.047+.5; tA += L(tT0,tT1,mT,rT, uv+vec2(cos(a),sin(a))*.007, dT, false).a; }
  tr.rgb += col*tr.a*(1.-tA/6.)*.6*(.3+.7*uSun);
  // the crown is lit from the upper left, darker underneath
  tr.rgb *= mix(1., .78 + .4*smoothstep(.75,.15,tl.y) , uSun*canopy);
  col = over(col, tr);
  hot *= 1.-tr.a;

  // ---- light: grade everything except what glows ----
  vec3 base = col;
  col *= uExp*uTint;
  float lum = dot(col, vec3(.2126,.7152,.0722));
  col = mix(vec3(lum), col, uSat);
  float ll = smoothstep(.08,.7,lum);
  col *= mix(vec3(1.), mix(vec3(.86,.93,1.08), vec3(1.07,1.03,.95), ll), uSun);      // sunlight: warm key, sky-blue fill
  col = mix(col, mix(vec3(lum), col, .85)*.97 + .015, (1.-uSun)*smoothstep(.3,.55,uExp)*.5); // overcast: flatter, softer
  col = mix(col, (col-.45)*1.08+.45, uSun);                                          // sun: crisper contrast
  col += vec3(1.,.97,.9)*.1*uSun*exp(-length((uv-vec2(-.05,-.08))*vec2(1.,1.4))*2.6); // sun glow off frame, upper left
  // lava keeps its own light, pulses and blooms
  float pulse = .8+.2*sin(T*1.8+fbm(uv*12.+T*.2)*6.);
  col = mix(col, base*(1.1+.3*pulse), hot*uLava);
  if(uLava>0.){
    vec3 bl = vec3(0.);
    for(int i=0;i<8;i++){ float a = float(i)*.785; vec2 o = vec2(cos(a),sin(a))*.02;
      vec2 q = uv+o; vec4 f2 = L(tF0,tF1,mF,rF,q,vec2(0.),true)*smoothstep(.6,.7,q.y); bl += f2.rgb*hotMask(f2.rgb); }
    col += bl/8.*vec3(1.,.32,.08)*uLava*pulse*.8;
  }
  col += uFlash*col*1.2;

  // ---- falling leaves while the tree lets go, embers at the very end ----
  vec3 tt;
  if(uLeaves>0.){
    float l1 = particles(uv, 14., T, vec2(.18,-.22), .6, .11, 5., tt);
    float l2 = particles(uv, 24., T, vec2(.12,-.16), .5, .1, 11., tt);
    vec3 lc = mix(vec3(.45,.26,.07), vec3(.3,.18,.08), tt.x)*uExp;
    col = mix(col, lc*(.55+.45*tt.y), max(l1,l2*.8)*uLeaves*step(tt.z,.95));
  }
  if(uEmbers>0.){
    float e = particles(uv, 26., T, vec2(.05,.55), .25, .07, 1., tt) + .6*particles(uv, 55., T, vec2(.08,.8), .3, .08, 7., tt);
    col += vec3(1.,.35,.06)*e*uEmbers*(.6+.4*sin(T*9.+uv.x*80.))*1.3*smoothstep(0.,.4,uv.y);
  }

  // ---- lens: vignette + fine grain ----
  vec2 q = gl_FragCoord.xy/uRes-.5;
  col *= 1.-dot(q,q)*.5;
  float fr = floor(T*24.); vec2 gp = gl_FragCoord.xy/uDpr;
  float gr = (vn(gp/1.2+fr*37.17)-.5)*1.2 + (h21(gp+fr*91.3)-.5)*.5;
  col += gr*.05*(1.-.5*dot(col,vec3(.333)));
  gl_FragColor = vec4(clamp(col,0.,1.),1.);
}`;
function sh(type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s)); return s; }
const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog); gl.useProgram(prog);
const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
const U = n => gl.getUniformLocation(prog, n);
const SLOT = { sky: 'S', mtn: 'M', mid: 'D', fg: 'F', tree: 'T' };
Object.entries(SLOT).forEach(([k, s], i) => { gl.uniform1i(U('t' + s + '0'), i * 2); gl.uniform1i(U('t' + s + '1'), i * 2 + 1); });

// textures: colour JPEG + optional greyscale alpha JPEG → one RGBA texture
const TEX = {};
const loadImg = src => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = src; });
async function buildTexture(name, hasAlpha) {
  const col = await loadImg(ASSETS[name]);
  const c = document.createElement('canvas'); c.width = col.width; c.height = col.height;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(col, 0, 0); const data = x.getImageData(0, 0, c.width, c.height);
  if (hasAlpha) {
    const a = await loadImg(ASSETS[name + '_a']); x.clearRect(0, 0, c.width, c.height); x.drawImage(a, 0, 0, c.width, c.height);
    const ad = x.getImageData(0, 0, c.width, c.height).data;
    for (let i = 0; i < ad.length; i += 4) data.data[i + 3] = ad[i];
  }
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  TEX[name] = t;
}
let ready = false;
Promise.all(Object.values(LAYERS).flatMap(L => L.states.map(s => buildTexture(s, L.alpha)))).then(() => { ready = true; });

function resize() { const d = Math.min(devicePixelRatio, 2); canvas.width = Math.round(panel.clientWidth * d); canvas.height = Math.round(panel.clientHeight * d); gl.viewport(0, 0, canvas.width, canvas.height); }
new ResizeObserver(resize).observe(panel); resize();

/* ============================================================
   LOOP
   ============================================================ */
let last = performance.now(), T = 0, nextStrike = 3, strikeT = -10;
function frame(now) {
  const dt = Math.min((now - last) / 1000, .05); last = now; T += dt;
  animMood += (targetMood - animMood) * (1 - Math.exp(-dt / 4.5));
  const m = animMood;
  if (params.has('debug')) dbgv.textContent = m.toFixed(2);

  if (ready) {
    let unit = 0;
    for (const [k, s] of Object.entries(SLOT)) {
      const Lr = LAYERS[k], [a, b, t] = stateAt(Lr.stops, m);
      gl.activeTexture(gl.TEXTURE0 + unit++); gl.bindTexture(gl.TEXTURE_2D, TEX[Lr.states[a]]);
      gl.activeTexture(gl.TEXTURE0 + unit++); gl.bindTexture(gl.TEXTURE_2D, TEX[Lr.states[b]]);
      gl.uniform1f(U('m' + s), t); gl.uniform4fv(U('r' + s), Lr.rect);
    }
    const G = gradeAt(m);
    // storm lightning between ~.25 and ~.55, and in the hellscape
    const storm = Math.max(1 - Math.abs(m - .27) / .12, 0) + (m < .05 ? .4 : 0);
    if (storm > .05 && T > nextStrike) { strikeT = T; nextStrike = T + (2 + Math.random() * 7) / storm; }
    const st = T - strikeT;
    const flash = st >= 0 && st < 1 ? Math.max(Math.exp(-st * 16), st > .12 ? .6 * Math.exp(-(st - .12) * 12) : 0, st > .3 ? .4 * Math.exp(-(st - .3) * 9) : 0) * clamp(storm, 0, 1) * .5 : 0;
    gl.uniform2f(U('uRes'), canvas.width, canvas.height); gl.uniform1f(U('uDpr'), canvas.width / panel.clientWidth);
    gl.uniform1f(U('uTime'), T); gl.uniform1f(U('uFlash'), flash);
    gl.uniform1f(U('uExp'), G.exp); gl.uniform1f(U('uSat'), G.sat); gl.uniform3fv(U('uTint'), G.tint);
    const sun = clamp((m - .42) / .45, 0, 1);
    gl.uniform1f(U('uSun'), sun * sun * (3 - 2 * sun));
    gl.uniform1f(U('uCloudSh'), clamp((m - .44) / .12, 0, 1) * (1 - .8 * clamp((m - .8) / .2, 0, 1)));
    gl.uniform1f(U('uLava'), clamp((.1 - m) / .1, 0, 1));
    gl.uniform1f(U('uEmbers'), clamp((.06 - m) / .06, 0, 1));
    gl.uniform1f(U('uLeaves'), Math.max(1 - Math.abs(m - .3) / .12, 0));
    gl.uniform1f(U('uWind'), lerp(.35, 1.3, Math.max(1 - Math.abs(m - .3) / .22, 0)));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
