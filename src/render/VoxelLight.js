// VoxelLight.js -- 体素光着色注入：把天光/方块光顶点属性接入 MeshBasicMaterial
// 顶点属性 voxelLight = (skyL, blockL)，均归一化 0..1
// 最终亮度 = max(uSunTint * skyL * uDayLight, uTorchTint * blockL)，再抬底 uMinLight
// uniform 对象全局共享：每帧只改这里，所有区块材质同步生效，无需重建网格
import * as THREE from 'three';

export const VoxelLightUniforms = {
  uDayLight: { value: 1.0 },                        // 天光昼夜系数（含夜晚月光底值）
  uSunTint: { value: new THREE.Color(1, 1, 1) },    // 天光染色（晨昏偏暖/夜晚偏冷）
  uMinLight: { value: 0.035 },                      // 最低环境亮度（纯黑洞穴留一点轮廓）
  uTorchTint: { value: new THREE.Color(1.0, 0.82, 0.58) } // 方块光暖色
};

export function applyVoxelLight(material) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uDayLight = VoxelLightUniforms.uDayLight;
    shader.uniforms.uSunTint = VoxelLightUniforms.uSunTint;
    shader.uniforms.uMinLight = VoxelLightUniforms.uMinLight;
    shader.uniforms.uTorchTint = VoxelLightUniforms.uTorchTint;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 voxelLight;\nvarying vec2 vVoxelLight;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvVoxelLight = voxelLight;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vVoxelLight;\nuniform float uDayLight;\nuniform vec3 uSunTint;\nuniform float uMinLight;\nuniform vec3 uTorchTint;')
      .replace('#include <color_fragment>', [
        '#include <color_fragment>',
        '{',
        '  vec3 skyC = uSunTint * (vVoxelLight.x * uDayLight);',
        '  vec3 torchC = uTorchTint * vVoxelLight.y;',
        '  vec3 lv = max(skyC, torchC);',
        '  lv = uMinLight + (1.0 - uMinLight) * lv;',
        '  diffuseColor.rgb *= lv;',
        '}'
      ].join('\n'));
  };
}
