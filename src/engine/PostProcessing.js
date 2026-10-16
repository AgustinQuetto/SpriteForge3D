import { ACESFilmicToneMapping, Vector2 } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export function postResolution(width, height, pixelRatio, resolution) {
  return pixelRatio * Math.min(resolution, Math.sqrt(2000000 / Math.max(1, width * height * pixelRatio * pixelRatio)));
}

export class PostProcessing {
  constructor(renderer) {
    this.renderer = renderer; this.composer = new EffectComposer(renderer); this.pass = new RenderPass(null, null);
    this.bloom = new UnrealBloomPass(new Vector2(1, 1), 0.7, 0.3, 0.8);
    this.vignette = new ShaderPass({ uniforms: { tDiffuse: { value: null }, amount: { value: 0.25 } },
      vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'uniform sampler2D tDiffuse; uniform float amount; varying vec2 vUv; void main(){vec4 c=texture2D(tDiffuse,vUv);float edge=smoothstep(0.15,0.7,length(vUv-0.5));gl_FragColor=vec4(c.rgb*(1.0-edge*amount),c.a);}',
    });
    this.output = new OutputPass();
    for (const pass of [this.pass, this.bloom, this.vignette, this.output]) this.composer.addPass(pass);
    this.size = new Vector2();
  }

  render(scene, camera, settings) {
    const renderer = this.renderer; renderer.getSize(this.size);
    const ratio = postResolution(this.size.x, this.size.y, renderer.getPixelRatio(), settings.resolution);
    const key = `${this.size.x}:${this.size.y}:${ratio}`;
    if (this.sizeKey !== key) { this.sizeKey = key; this.composer.setPixelRatio(ratio); this.composer.setSize(this.size.x, this.size.y); }
    this.pass.scene = scene; this.pass.camera = camera;
    Object.assign(this.bloom, { enabled: settings.bloom > 0, strength: settings.bloom, radius: settings.bloomRadius, threshold: settings.bloomThreshold });
    this.vignette.enabled = settings.vignette > 0; this.vignette.uniforms.amount.value = settings.vignette;
    const previous = { toneMapping: renderer.toneMapping, exposure: renderer.toneMappingExposure, autoReset: renderer.info.autoReset };
    try {
      renderer.toneMapping = ACESFilmicToneMapping; renderer.toneMappingExposure = settings.exposure;
      renderer.info.reset(); renderer.info.autoReset = false; this.composer.render(0);
    } finally { renderer.toneMapping = previous.toneMapping; renderer.toneMappingExposure = previous.exposure; renderer.info.autoReset = previous.autoReset; }
  }

  dispose() { for (const pass of [this.pass, this.bloom, this.vignette, this.output]) pass.dispose(); this.composer.dispose(); }
}
