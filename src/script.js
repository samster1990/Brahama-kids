import * as THREE from 'three'
import { ShaderMaterial, Vector2 } from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import GUI from 'lil-gui'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

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

// Group to keep stem, leaves and particles moving together
const treeGroup = new THREE.Group()
scene.add(treeGroup)

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
    treeGroup.add(gltf.scene)
})

/**
 * Load Tree Leaves
 */
let leavesMesh = null

// --- Custom ShaderMaterial for tree leaves and particles with shared gradient and glow ---
const leafUniforms = {
  uTime: { value: 0 },
  uMouse: { value: new Vector2(0.5, 0.5) },
  uResolution: { value: new Vector2(window.innerWidth, window.innerHeight) },
  uColorTop: { value: new THREE.Color('#d88f1a') },    // mustard top
  uColorBottom: { value: new THREE.Color('#ffe0a3ff') }, // warm golden bottom
  uYMin: { value: 0 },
  uYMax: { value: 1 },
  uPointSize: { value: 4.0 },
  // --- Hover impulse uniforms ---
  uHitPos: { value: new THREE.Vector3() },      // world-space hit position
  uHitTime: { value: 0 },                        // seconds
  uHitRadius: { value: 0.2 },                    // world units radius
  uHitStrength: { value: 0.4 },                 // displacement scale
  uHitDamp: { value: 2.0 },                      // decay rate (bigger = quicker fade)
};

window.addEventListener('mousemove', (e) => {
  leafUniforms.uMouse.value.x = e.clientX / window.innerWidth;
  leafUniforms.uMouse.value.y = 1.0 - e.clientY / window.innerHeight;
});

const leafVertexShader = `
  uniform float uTime;
  uniform vec2 uMouse;
  uniform vec3 uHitPos;
  uniform float uHitTime;
  uniform float uHitRadius;
  uniform float uHitStrength;
  uniform float uHitDamp;
  varying vec2 vUv;
  varying float vGlow;

  // Simple hash function for random offset
  float rand(float x) { return fract(sin(x) * 43758.5453123); }

  void main() {
    vUv = uv;

    // random per-vertex phase
    float offset = rand(position.x + position.y + position.z);

    // base position with subtle idle flutter
    vec3 pos = position;
    pos.x += sin(uTime * 2.0 + offset * 10.0) * 0.02;
    pos.y += cos(uTime * 1.5 + offset * 10.0) * 0.02;

    // screen-space glow (for color boosting)
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    vec4 projected = projectionMatrix * mvPosition;
    vec2 screenPos = projected.xy / projected.w;
    float distMouse = distance(screenPos, uMouse * 2.0 - 1.0);
    vGlow = 1.0 - smoothstep(0.0, 0.5, distMouse);

    // --- physics-like hover impulse ---
    // compute world-space vertex position
    vec3 worldPos = (modelMatrix * vec4(pos, 1.0)).xyz;
    float d = distance(worldPos, uHitPos);
    float radius = max(0.0001, uHitRadius);
    float influence = 1.0 - smoothstep(radius, 0.0, d); // 1 at center -> 0 at edge

    // time decay since the last hit
    float dt = max(0.0, uTime - uHitTime);
    float decay = exp(-uHitDamp * dt);

    // displace outward along normal with a bit of oscillation to feel springy
    vec3 n = normalize(normalMatrix * normal);
    float spring = sin((uTime - uHitTime) * 8.0 + offset * 6.0) * 0.5 + 0.5; // 0..1
    float disp = uHitStrength * influence * decay * (0.6 + 0.4 * spring);
    pos += n * disp;

    // subtle extra displacement stronger near the hit area using the screen glow factor
    pos += n * (0.01 * vGlow);

    mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const leafFragmentShader = `
  uniform vec3 uColorTop;
  uniform vec3 uColorBottom;
  varying vec2 vUv;
  varying float vGlow;
  void main() {
    float t = clamp(vUv.y, 0.0, 1.0);
    vec3 base = mix(uColorBottom, uColorTop, t);
    vec3 col = base * (1.0 + vGlow * 0.8);
    float alpha = 0.9; // slightly more opaque for solid canopy
    gl_FragColor = vec4(col, alpha);
  }
`;

const treeLeavesMaterial = new ShaderMaterial({
  vertexShader: leafVertexShader,
  fragmentShader: leafFragmentShader,
  uniforms: leafUniforms,
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide
});

let canopySampler = null
let sampleTarget = null

gltfLoader.load('/models/treeleaves.glb', (gltf) => {
    const wrapper = new THREE.Object3D()
    wrapper.add(gltf.scene)
    treeGroup.add(wrapper)

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

    // Initialize hover-reactive leaf cloud once leavesMesh is in the scene
    initLeafCloud()
})

/**
 * Floor
 */
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
 * Particle shaders for floating leaf cloud (gradient + hover glow)
 */
const particleVertexShader = `
  uniform float uTime;
  uniform vec2 uMouse;
  uniform float uPointSize;
  uniform float uYMin;
  uniform float uYMax;
  varying float vGlow;
  varying float vT;
  void main() {
    vec3 pos = position;
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    vec4 proj = projectionMatrix * mv;
    vec2 screenPos = proj.xy / proj.w;
    float dist = distance(screenPos, uMouse * 2.0 - 1.0);
    vGlow = 1.0 - smoothstep(0.0, 0.5, dist);

    // height factor for gradient mapping
    float t = clamp((pos.y - uYMin) / max(0.0001, (uYMax - uYMin)), 0.0, 1.0);
    vT = t;

    // point size with perspective attenuation
    gl_PointSize = uPointSize * (200.0 / max(1.0, -mv.z));
    gl_Position = projectionMatrix * mv;
  }
`;

const particleFragmentShader = `
  uniform vec3 uColorTop;
  uniform vec3 uColorBottom;
  varying float vGlow;
  varying float vT;
  void main() {
    // circular point sprite
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p);
    if (d > 0.5) discard;

    vec3 base = mix(uColorBottom, uColorTop, vT);
    vec3 col = base * (1.0 + vGlow * 0.8);
    float alpha = smoothstep(0.5, 0.0, d) * (0.85 + vGlow * 0.15);
    gl_FragColor = vec4(col, alpha);
  }
`;

/**
 * Leaf Cloud (hover -> disperse with gravity & friction)
 */
let leafCloud = null
let leafCloudGeom = null
let leafCloudMat = null
let leafCloudPositions = null // Float32Array (x,y,z)*N
let leafCloudVelocities = null // Float32Array (x,y,z)*N
let leafCloudActive = null // Uint8Array
let leafCloudSeeds = null // Float32Array random phase per particle
const LEAF_CLOUD_COUNT = 1400
const LEAF_GRAVITY = 0.6 // world units per sec^2
const LEAF_FRICTION = 0.985
// --- Tunables for leaf cloud hover reaction ---
let LEAF_REACT_PROB = 0.3    // 0..1 chance a nearby particle reacts
let LEAF_MAX_AFFECTED = 12  // hard cap per pointer move
let leafCloudOriginalAABB = null
// Hover timing for group sway boost
let lastLeafHoverTime = 0
// Hover state for smooth sway and elastic release
let isHoveringTree = false
let wasHoveringTree = false
let hoverStrength = 0 // eased 0..1
let releaseBounceTime = 0
let hoverPullDir = new THREE.Vector2(0, 0) // XZ pull direction while hovering

const raycaster = new THREE.Raycaster()
const pointerNDC = new Vector2()

function initLeafCloud() {
    // Use the leaves wrapper bounds
    const box = new THREE.Box3().setFromObject(leavesMesh)
    leafCloudOriginalAABB = box.clone()

    const size = new THREE.Vector3()
    box.getSize(size)

    // Slightly expand so particles surround the canopy
    const expand = size.length() * 0.01
    box.min.addScalar(-expand)
    box.max.addScalar(+expand)

    // Build a surface sampler from the actual leaves geometry so particles cling to the canopy shape
    const leafGeometries = []
    leavesMesh.traverse((child) => {
        if (child.isMesh && child.geometry) {
            const g = child.geometry.clone()
            g.applyMatrix4(child.matrixWorld) // bake world transform
            // ensure non-indexed for stable sampling
            if (g.index) g.toNonIndexed()
            leafGeometries.push(g)
        }
    })
    const mergedLeavesGeometry = mergeGeometries(leafGeometries, false)
    const canopyMeshForSampling = new THREE.Mesh(mergedLeavesGeometry)
    canopySampler = new MeshSurfaceSampler(canopyMeshForSampling).build()
    sampleTarget = new THREE.Vector3()

    leafCloudGeom = new THREE.BufferGeometry()
    leafCloudPositions = new Float32Array(LEAF_CLOUD_COUNT * 3)
    leafCloudVelocities = new Float32Array(LEAF_CLOUD_COUNT * 3)
    leafCloudActive = new Uint8Array(LEAF_CLOUD_COUNT)
    leafCloudSeeds = new Float32Array(LEAF_CLOUD_COUNT)

    for (let i = 0; i < LEAF_CLOUD_COUNT; i++) {
        const i3 = i * 3
        canopySampler.sample(sampleTarget)
        // small outward jitter to create volume
        const jx = (Math.random() - 0.5) * 0.006
        const jy = (Math.random() - 0.5) * 0.006
        const jz = (Math.random() - 0.5) * 0.006
        leafCloudPositions[i3]     = sampleTarget.x + jx
        leafCloudPositions[i3 + 1] = sampleTarget.y + jy
        leafCloudPositions[i3 + 2] = sampleTarget.z + jz

        leafCloudVelocities[i3] = 0
        leafCloudVelocities[i3 + 1] = 0
        leafCloudVelocities[i3 + 2] = 0

        leafCloudActive[i] = 0 // start idle
        leafCloudSeeds[i] = Math.random() * Math.PI * 2
    }

    leafCloudGeom.setAttribute('position', new THREE.BufferAttribute(leafCloudPositions, 3))

    // Set Y range for particle gradient mapping
    leafUniforms.uYMin.value = box.min.y;
    leafUniforms.uYMax.value = box.max.y;
    leafUniforms.uPointSize.value = 0.06; // tune point size if needed

    leafCloudMat = new THREE.ShaderMaterial({
        uniforms: leafUniforms,
        vertexShader: particleVertexShader,
        fragmentShader: particleFragmentShader,
        transparent: true,
        depthWrite: false,
        blending: THREE.NormalBlending
    })

    leafCloud = new THREE.Points(leafCloudGeom, leafCloudMat)
    leafCloud.frustumCulled = false
    treeGroup.add(leafCloud)

    // Pointer hover -> disturb particles near intersection and set hover state
    function onPointerMove(clientX, clientY) {
        pointerNDC.set(
            (clientX / sizes.width) * 2 - 1,
            - (clientY / sizes.height) * 2 + 1
        )
        raycaster.setFromCamera(pointerNDC, camera)
        const intersects = raycaster.intersectObject(leavesMesh, true)
        const nowSec = performance.now() / 1000
        if (intersects.length > 0) {
            const p = intersects[0].point
            // Set hover impulse uniforms for shader
            leafUniforms.uHitPos.value.copy(p)
            leafUniforms.uHitTime.value = nowSec
            lastLeafHoverTime = nowSec
            // Mark hovering and compute gentle pull direction in XZ toward cursor
            isHoveringTree = true
            const pullX = p.x - treeGroup.position.x
            const pullZ = p.z - treeGroup.position.z
            hoverPullDir.set(pullX, pullZ)
            if (hoverPullDir.lengthSq() > 0.000001) hoverPullDir.normalize()
            disturbLeafCloud(p)
        } else {
            // No hit: if we were hovering, mark release for elastic bounce
            isHoveringTree = false
        }
        // Detect transition hover->release to start elastic bounce timer
        if (wasHoveringTree && !isHoveringTree) {
            releaseBounceTime = nowSec
        }
        wasHoveringTree = isHoveringTree
    }

    window.addEventListener('pointermove', (e) => onPointerMove(e.clientX, e.clientY))
    window.addEventListener('touchmove', (e) => {
        if (e.touches && e.touches.length > 0) {
            const t = e.touches[0]
            onPointerMove(t.clientX, t.clientY)
        }
    }, { passive: true })
}

function disturbLeafCloud(point) {
    if (!leafCloudPositions) return

    let affected = 0

    const radius = leafCloudOriginalAABB.getSize(new THREE.Vector3()).length() * 0.08
    const radius2 = radius * radius
    const power = 0.2 // initial impulse magnitude

    for (let i = 0; i < LEAF_CLOUD_COUNT; i++) {
        const i3 = i * 3
        const dx = leafCloudPositions[i3] - point.x
        const dy = leafCloudPositions[i3 + 1] - point.y
        const dz = leafCloudPositions[i3 + 2] - point.z
        const d2 = dx*dx + dy*dy + dz*dz
        if (d2 < radius2) {
            // Only some particles react (probability gate)
            if (Math.random() > LEAF_REACT_PROB) continue

            const invD = 1.0 / Math.sqrt(d2 + 1e-6)
            // Direction away from pointer
            const ux = dx * invD
            const uy = dy * invD
            const uz = dz * invD
            // Lateral push reduced; Y has tiny up and stronger down bias
            leafCloudVelocities[i3]     += ux * power * (1.0 - d2 / radius2)
            leafCloudVelocities[i3 + 1] += (uy * power * 0.05 - 0.25)
            leafCloudVelocities[i3 + 2] += uz * power * (1.0 - d2 / radius2)
            // Mark as active (will fall with gravity)
            leafCloudActive[i] = 1
            affected++
            if (affected >= LEAF_MAX_AFFECTED) break
        }
    }
}

function updateLeafCloud(deltaTime, elapsedTime) {
    if (!leafCloudGeom) return
    const pos = leafCloudPositions
    const vel = leafCloudVelocities
    const seeds = leafCloudSeeds

    const groundY = -0.1 // approximate terrain height near tree
    const g = LEAF_GRAVITY
    const f = Math.pow(LEAF_FRICTION, Math.max(deltaTime, 0.016))

    for (let i = 0; i < LEAF_CLOUD_COUNT; i++) {
        const i3 = i * 3

        if (leafCloudActive[i]) {
            // Physics: gravity + friction
            vel[i3 + 1] -= g * deltaTime
            vel[i3] *= f
            vel[i3 + 1] *= f
            vel[i3 + 2] *= f

            pos[i3]     += vel[i3] * deltaTime
            pos[i3 + 1] += vel[i3 + 1] * deltaTime
            pos[i3 + 2] += vel[i3 + 2] * deltaTime

            // Despawn & respawn when below ground
            if (pos[i3 + 1] < groundY) {
                // respawn back on the canopy surface
                canopySampler.sample(sampleTarget)
                pos[i3]     = sampleTarget.x
                pos[i3 + 1] = sampleTarget.y
                pos[i3 + 2] = sampleTarget.z
                vel[i3] = vel[i3 + 1] = vel[i3 + 2] = 0
                leafCloudActive[i] = 0
            }
        } else {
            // Idle: tiny wind jitter to keep the cloud alive
            const s = seeds[i]
            pos[i3]     += Math.sin(elapsedTime * 0.8 + s) * 0.0006
            pos[i3 + 1] += Math.cos(elapsedTime * 1.1 + s * 1.7) * 0.0006
            pos[i3 + 2] += Math.sin(elapsedTime * 0.9 + s * 0.6) * 0.0006
        }
    }

    leafCloudGeom.attributes.position.needsUpdate = true
}

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

    // Update interactive leaf cloud
    updateLeafCloud(deltaTime, elapsedTime)

    // Subtle whole-tree sway with eased hover and elastic release
    const SWAY_BASE_AMPL = 0.005   // base rotation amplitude (radians)
    const SWAY_HOVER_AMPL = 0.010  // added amplitude under hover
    const SWAY_SPEED = 0.5         // base sway speed

    // Smoothly ease hoverStrength to 1 while hovering, to 0 when not
    const target = isHoveringTree ? 1 : 0
    const easeRate = isHoveringTree ? 6.0 : 4.0 // faster ease-in, slightly slower ease-out
    const easeFactor = 1 - Math.exp(-easeRate * Math.max(deltaTime, 0.016))
    hoverStrength += (target - hoverStrength) * easeFactor

    // Base sway in Z, plus extra amplitude from hover
    let swayZ = Math.sin(elapsedTime * SWAY_SPEED) * (SWAY_BASE_AMPL + SWAY_HOVER_AMPL * hoverStrength)

    // Elastic "rubber-band" bounce right after release
    const tRelease = performance.now() / 1000 - releaseBounceTime
    if (!isHoveringTree && tRelease >= 0 && tRelease < 0.4) {
        const bounce = Math.exp(-tRelease * 8.0) * Math.sin(tRelease * 18.0) // quick damped oscillation
        swayZ += bounce * 0.008
    }

    // Subtle lean toward cursor while hovering (edge pull). Very small on Y rotation.
    const pullLean = hoverStrength * 0.02
    const leanY = hoverPullDir.x * pullLean // side lean

    treeGroup.rotation.z = swayZ
    treeGroup.rotation.y = leanY

    // Render
    renderer.render(scene, camera)

    //helper for camera positioning
    // console.log('Camera Pos:', camera.position)
    // console.log('Controls Target:', controls.target)

    // Call tick again on the next frame
    window.requestAnimationFrame(tick)
}

tick()