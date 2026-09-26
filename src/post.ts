// the camera. the scene is painted on a 2d canvas, this pass films it through a lens
// that can overexpose, bloom, split colour at the edges, blur toward the impact and
// bend light where the pressure wave runs. without webgl the 2d canvas is shown as is.

export type Lens = {
  // impact point in uv, 0 to 1 from the top left
  centerX: number;
  centerY: number;
  // the pressure wave, radius and width in screen heights, strength in uv
  shockRadius: number;
  shockWidth: number;
  shockStrength: number;
  aberration: number;
  zoomBlur: number;
  exposure: number;
  bloom: number;
  defocus: number;
  zoom: number;
  shakeX: number;
  shakeY: number;
  time: number;
};

const VERTEX = `
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

// nine tap gaussian, run horizontally then vertically at a quarter of the size
const BLUR = `
precision mediump float;
uniform sampler2D source;
uniform vec2 step;
varying vec2 vUv;
void main() {
  vec3 colour = texture2D(source, vUv).rgb * 0.227;
  colour += texture2D(source, vUv + step * 1.385).rgb * 0.316;
  colour += texture2D(source, vUv - step * 1.385).rgb * 0.316;
  colour += texture2D(source, vUv + step * 3.231).rgb * 0.070;
  colour += texture2D(source, vUv - step * 3.231).rgb * 0.070;
  gl_FragColor = vec4(colour, 1.0);
}`;

const COMPOSITE = `
precision highp float;
uniform sampler2D scene;
uniform sampler2D blurred;
uniform float aspect;
uniform vec2 center;
uniform float shockRadius;
uniform float shockWidth;
uniform float shockStrength;
uniform float aberration;
uniform float zoomBlur;
uniform float exposure;
uniform float bloom;
uniform float defocus;
uniform float zoom;
uniform vec2 shake;
uniform float time;
varying vec2 vUv;

float hash(vec2 point) {
  return fract(sin(dot(point, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 uv = (vUv - 0.5) / zoom + 0.5 + shake;

  // the pressure wave bends light across a thin band, nothing is drawn
  vec2 fromCenter = vec2((uv.x - center.x) * aspect, uv.y - center.y);
  float distance = length(fromCenter);
  float band = exp(-pow((distance - shockRadius) / shockWidth, 2.0));
  vec2 outward = distance > 0.0001 ? fromCenter / distance : vec2(0.0);
  uv -= vec2(outward.x / aspect, outward.y) * band * shockStrength;

  // zoom blur toward the impact, the colours split a little further out
  vec2 toward = uv - center;
  vec3 colour = vec3(0.0);
  for (int index = 0; index < 8; index++) {
    float along = 1.0 - zoomBlur * float(index) / 7.0;
    vec2 point = center + toward * along;
    vec2 split = toward * aberration;
    colour.r += texture2D(scene, point + split).r;
    colour.g += texture2D(scene, point).g;
    colour.b += texture2D(scene, point - split).b;
  }
  colour /= 8.0;

  vec3 soft = texture2D(blurred, uv).rgb;
  colour = mix(colour, soft, defocus);
  colour += soft * bloom;

  // overexposure, the bright parts burn out first, then the whole frame
  colour = colour * (1.0 + exposure * 3.0) + exposure * 0.4 * vec3(0.95, 0.97, 1.0);

  float edge = length(vUv - 0.5);
  colour *= 1.0 - smoothstep(0.45, 0.95, edge) * 0.55;
  colour += (hash(vUv * 1000.0 + time) - 0.5) * 0.025;
  gl_FragColor = vec4(clamp(colour, 0.0, 1.0), 1.0);
}`;

type Target = { texture: WebGLTexture; framebuffer: WebGLFramebuffer; width: number; height: number };

export class LensPass {
  private gl: WebGLRenderingContext;
  private sceneTexture: WebGLTexture;
  private blurProgram: WebGLProgram;
  private compositeProgram: WebGLProgram;
  private targets: [Target, Target] | null = null;
  private uniforms = new Map<string, WebGLUniformLocation | null>();

  static create(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      premultipliedAlpha: false,
      // screenshots in development read the frame after it was presented
      preserveDrawingBuffer: import.meta.env.DEV,
    });
    if (!gl) return null;
    try {
      return new LensPass(gl);
    } catch {
      return null;
    }
  }

  private constructor(gl: WebGLRenderingContext) {
    this.gl = gl;
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.blurProgram = this.program(BLUR);
    this.compositeProgram = this.program(COMPOSITE);
    this.sceneTexture = this.texture();
  }

  private program(fragment: string) {
    const gl = this.gl;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) throw new Error("no shader");
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "shader");
      return shader;
    };
    const program = gl.createProgram();
    if (!program) throw new Error("no program");
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "link");
    return program;
  }

  private texture() {
    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) throw new Error("no texture");
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  private target(width: number, height: number): Target {
    const gl = this.gl;
    const texture = this.texture();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const framebuffer = gl.createFramebuffer();
    if (!framebuffer) throw new Error("no framebuffer");
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    return { texture, framebuffer, width, height };
  }

  private uniform(program: WebGLProgram, name: string) {
    const key = `${program === this.blurProgram ? "blur" : "composite"}.${name}`;
    if (!this.uniforms.has(key)) this.uniforms.set(key, this.gl.getUniformLocation(program, name));
    return this.uniforms.get(key) ?? null;
  }

  private use(program: WebGLProgram) {
    const gl = this.gl;
    gl.useProgram(program);
    const position = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  }

  render(scene: HTMLCanvasElement, lens: Lens) {
    const gl = this.gl;
    const width = gl.canvas.width;
    const height = gl.canvas.height;
    const smallWidth = Math.max(1, Math.round(width / 4));
    const smallHeight = Math.max(1, Math.round(height / 4));
    if (!this.targets || this.targets[0].width !== smallWidth || this.targets[0].height !== smallHeight) {
      this.targets = [this.target(smallWidth, smallHeight), this.target(smallWidth, smallHeight)];
    }
    const [first, second] = this.targets;

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, scene);

    // two rounds of blur at a quarter size, wide enough for a focus pull
    this.use(this.blurProgram);
    gl.uniform1i(this.uniform(this.blurProgram, "source"), 0);
    let source: WebGLTexture = this.sceneTexture;
    const passes: Array<[Target, number, number]> = [
      [first, 1 / smallWidth, 0],
      [second, 0, 1 / smallHeight],
      [first, 2 / smallWidth, 0],
      [second, 0, 2 / smallHeight],
    ];
    for (const [target, stepX, stepY] of passes) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      gl.viewport(0, 0, target.width, target.height);
      gl.bindTexture(gl.TEXTURE_2D, source);
      gl.uniform2f(this.uniform(this.blurProgram, "step"), stepX, stepY);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      source = target.texture;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    const program = this.compositeProgram;
    this.use(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTexture);
    gl.uniform1i(this.uniform(program, "scene"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, second.texture);
    gl.uniform1i(this.uniform(program, "blurred"), 1);
    gl.uniform1f(this.uniform(program, "aspect"), width / height);
    // uv in the shader runs bottom up
    gl.uniform2f(this.uniform(program, "center"), lens.centerX, 1 - lens.centerY);
    gl.uniform1f(this.uniform(program, "shockRadius"), lens.shockRadius);
    gl.uniform1f(this.uniform(program, "shockWidth"), lens.shockWidth);
    gl.uniform1f(this.uniform(program, "shockStrength"), lens.shockStrength);
    gl.uniform1f(this.uniform(program, "aberration"), lens.aberration);
    gl.uniform1f(this.uniform(program, "zoomBlur"), lens.zoomBlur);
    gl.uniform1f(this.uniform(program, "exposure"), lens.exposure);
    gl.uniform1f(this.uniform(program, "bloom"), lens.bloom);
    gl.uniform1f(this.uniform(program, "defocus"), lens.defocus);
    gl.uniform1f(this.uniform(program, "zoom"), lens.zoom);
    gl.uniform2f(this.uniform(program, "shake"), lens.shakeX, -lens.shakeY);
    gl.uniform1f(this.uniform(program, "time"), lens.time % 100);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
