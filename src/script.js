import * as THREE from 'three'
import { ShaderMaterial, Vector2 } from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import GUI from 'lil-gui'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'

/**
 * Base
 */
// Debug
const gui = new GUI()

// Canvas
const canvas = document.querySelector('canvas.webgl')

// Scene
const scene = new THREE.Scene()
scene.fog = new THREE.Fog('#ffae42', 1, 8)
scene.background = null

/**
 * Models
 */
const dracoLoader = new DRACOLoader()
dracoLoader.setDecoderPath('/draco/')

const gltfLoader = new GLTFLoader()
gltfLoader.setDRACOLoader(dracoLoader)

let mixer = null


/**
 * Load Boy (with animation)
 */
gltfLoader.load('/models/boy.glb', (gltf) => {
    gltf.scene.position.set(0.21, 1.07, 0.21)
    gltf.scene.rotation.y = 2.45
    gltf.scene.scale.set(50, 50, 50)
    scene.add(gltf.scene)

    // Make the eye material glow
    gltf.scene.traverse((child) => {
        if (child.isMesh && child.material && child.material.name === 'Material.002mat') {
            child.material.emissive = new THREE.Color(0xffffff)
            child.material.emissiveIntensity = 2
            child.material.needsUpdate = true
        }
    })

    mixer = new THREE.AnimationMixer(gltf.scene)
    const action = mixer.clipAction(gltf.animations[0])
    action.play()
})

/**
 * Load Terrain
 */
gltfLoader.load('/models/terrain.glb', (gltf) => {
    gltf.scene.position.set(0, -0.2, 0)
    gltf.scene.scale.set(3.5, 3.5, 3.5)
    gltf.scene.rotation.y = Math.PI / 0.264
    scene.add(gltf.scene)
})

/**
 * Load Tree Stem + Branches
 */
gltfLoader.load('/models/tree-stem-branch.glb', (gltf) => {
    gltf.scene.position.set(2.3, 0.99, -0.16)
    gltf.scene.scale.set(5.8, 5.8, 5.8)
    gltf.scene.rotation.y = 0.21
    scene.add(gltf.scene)
})

/**
 * Load Tree Leaves
 */
let leavesMesh = null

// --- Custom ShaderMaterial for tree leaves ---
const leafUniforms = {
  uTime: { value: 0 },
  uMouse: { value: new Vector2(0.5, 0.5) },
  uResolution: { value: new Vector2(window.innerWidth, window.innerHeight) }
};

window.addEventListener('mousemove', (e) => {
  leafUniforms.uMouse.value.x = e.clientX / window.innerWidth;
  leafUniforms.uMouse.value.y = 1.0 - e.clientY / window.innerHeight;
});

const leafVertexShader = `
  uniform float uTime;
  uniform vec2 uMouse;
  varying float vDist;

  void main() {
    vec3 pos = position;

    // Distance from mouse to vertex
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    vec4 projected = projectionMatrix * mvPosition;
    vec2 screenPos = projected.xy / projected.w;

    float dist = distance(screenPos, uMouse * 2.0 - 1.0);
    vDist = dist;

    float strength = smoothstep(0.4, 0.0, dist);

    // Base wind motion
    pos.x += sin(uTime * 2.0 + position.y * 5.0) * 0.05;
    pos.y += cos(uTime * 1.5 + position.x * 4.0) * 0.05;

    // Mouse interaction overlay
    vec2 dir = normalize((uMouse * 2.0 - 1.0) - screenPos);
    pos.x += dir.x * strength * 0.1;
    pos.y += dir.y * strength * 0.1;

    gl_PointSize = 1.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const leafFragmentShader = `
  uniform float uTime;
  varying float vDist;

  void main() {
    vec3 color = vec3(1.0, 0.85, 0.3); // golden hue
    float fade = 1.0 - smoothstep(0.1, 0.5, vDist);
    gl_FragColor = vec4(color * (0.7 + fade * 0.6), 1.0);
  }
`;

const treeLeavesMaterial = new ShaderMaterial({
  vertexShader: leafVertexShader,
  fragmentShader: leafFragmentShader,
  uniforms: leafUniforms,
  transparent: true
});

gltfLoader.load('/models/treeleaves.glb', (gltf) => {
    const wrapper = new THREE.Object3D()
    wrapper.add(gltf.scene)
    scene.add(wrapper)

    // Traverse meshes and set custom ShaderMaterial
    gltf.scene.traverse((child) => {
        if (child.isMesh) {
            child.material = treeLeavesMaterial
            child.material.needsUpdate = true
        }
    })

    // Save reference to wrapper for interactivity
    leavesMesh = wrapper

    // Set wrapper transforms as requested
    wrapper.position.set(-2.32, 0.98, 0.84)
    wrapper.scale.set(5.8, 5.8, 5.8)
    wrapper.rotation.y = 0.21
})

// /**
//  * Floor
//  */
// const floor = new THREE.Mesh(
//     new THREE.PlaneGeometry(10, 10),
//     new THREE.MeshStandardMaterial({
//         color: '#444444',
//         metalness: 0,
//         roughness: 0.5
//     })
// )
// floor.receiveShadow = true
// floor.rotation.x = - Math.PI * 0.5
// scene.add(floor)

/**
 * Lights
 */
// Lighting: Magical golden hour


const ambientLight = new THREE.AmbientLight(0xffe6b3, 0.3)
scene.add(ambientLight)

const dirLight = new THREE.DirectionalLight(0xffcc66, 1.2)
dirLight.castShadow = true
dirLight.position.set(-3, 5, -5)
scene.add(dirLight)

/**
 * Sizes
 */
const sizes = {
    width: window.innerWidth,
    height: window.innerHeight
}

window.addEventListener('resize', () =>
{
    // Update sizes
    sizes.width = window.innerWidth
    sizes.height = window.innerHeight

    // Update camera
    camera.aspect = sizes.width / sizes.height
    camera.updateProjectionMatrix()

    // Update renderer
    renderer.setSize(sizes.width, sizes.height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
})

/**
 * Camera
 */
// Base camera
const camera = new THREE.PerspectiveCamera(75, sizes.width / sizes.height, 0.1, 100)
camera.position.set(2, 2, 1.8)
scene.add(camera)

// Controls
const controls = new OrbitControls(camera, canvas)
controls.target.set(0, 1.75, 0)
controls.enableDamping = true

// Add background gradient mesh
const bgGeometry = new THREE.PlaneGeometry(40, 40)
const bgMaterial = new THREE.ShaderMaterial({
    uniforms: {
        uColor1: { value: new THREE.Color('#ffcc88') }, // warm center glow
        uColor2: { value: new THREE.Color('#2c1200') }, // outer dark color
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        varying vec2 vUv;
        uniform vec3 uColor1;
        uniform vec3 uColor2;
        void main() {
            float dist = distance(vUv, vec2(0.5));
            float smoothDist = smoothstep(0.0, 1.0, dist * 1.5);
            vec3 color = mix(uColor1, uColor2, smoothDist);
            gl_FragColor = vec4(color, 1.0);
        }
    `,
    depthWrite: false,
    side: THREE.BackSide
})

const bgMesh = new THREE.Mesh(bgGeometry, bgMaterial)
bgMesh.position.set(-2.6, -2.1, 0)
bgMesh.rotation.y = -2.11
bgMesh.scale.set(1, 1, 1)
scene.add(bgMesh)

/**
 * Renderer
 */
const renderer = new THREE.WebGLRenderer({
    canvas: canvas
})
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.setSize(sizes.width, sizes.height)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

/**
 * Falling Leaves Particle Burst
 */
const leafParticles = new THREE.Group()
scene.add(leafParticles)

const leafTexture = new THREE.TextureLoader().load('/textures/leaf.png')
const particleGeometry = new THREE.PlaneGeometry(0.1, 0.1)
const particleMaterial = new THREE.MeshBasicMaterial({
    map: leafTexture,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false
})

const maxParticles = 100
const particles = []

for (let i = 0; i < maxParticles; i++) {
    const particle = new THREE.Mesh(particleGeometry, particleMaterial.clone())
    particle.visible = false
    leafParticles.add(particle)
    particles.push({
        mesh: particle,
        velocity: new THREE.Vector3(),
        life: 0
    })
}

// Trigger burst near mouse
window.addEventListener('click', () => {
    const mouseX = (leafUniforms.uMouse.value.x - 0.5) * 6.0
    const mouseY = (leafUniforms.uMouse.value.y - 0.5) * 6.0

    let count = 0
    for (const p of particles) {
        if (count >= 15) break
        if (!p.mesh.visible) {
            p.mesh.visible = true
            p.mesh.position.set(mouseX + (Math.random() - 0.5) * 0.5, mouseY + 1.2, (Math.random() - 0.5) * 0.2)
            p.velocity.set((Math.random() - 0.5) * 0.05, -Math.random() * 0.02, (Math.random() - 0.5) * 0.05)
            p.life = 2 + Math.random()
            count++
        }
    }
})

/**
 * Animate
 */
const clock = new THREE.Clock()
let previousTime = 0

const tick = () =>
{
    const elapsedTime = clock.getElapsedTime()
    const deltaTime = elapsedTime - previousTime
    previousTime = elapsedTime

    // Model animation
    if(mixer)
    {
        mixer.update(deltaTime)
    }

    // Update controls
    controls.update()

    // Update leaf shader time uniform
    leafUniforms.uTime.value = performance.now() / 1000;

    // Update falling leaves
    for (const p of particles) {
        if (p.mesh.visible) {
            p.mesh.position.add(p.velocity)
            p.velocity.y -= 0.001
            p.life -= deltaTime
            if (p.life <= 0) {
                p.mesh.visible = false
            }
        }
    }

    // Render
    renderer.render(scene, camera)

    //helper for camera positioning
    console.log('Camera Pos:', camera.position)
    console.log('Controls Target:', controls.target)

    // Call tick again on the next frame
    window.requestAnimationFrame(tick)
}

tick()