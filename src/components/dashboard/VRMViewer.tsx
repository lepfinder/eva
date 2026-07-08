import React, { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { VRMLoaderPlugin, VRMUtils, VRM } from '@pixiv/three-vrm'

interface VRMViewerProps {
  modelPath?: string
  className?: string
}

export function VRMViewer({
  modelPath = './EVA.vrm',
  className = ""
}: VRMViewerProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  // Refs for Three.js objects
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const currentVrmRef = useRef<VRM | null>(null)
  const clockRef = useRef(new THREE.Clock()) // 虽然有警告，但为了稳定先保持。如果需要可改为 Timer
  const requestRef = useRef<number | null>(null)
  // 入场动画状态
  const entranceRef = useRef({ active: false, elapsed: 0, duration: 1.6 })

  useEffect(() => {
    if (!containerRef.current) return
    
    let handleResize: (() => void) | undefined;

    try {
    // 1. Scene Setup
    const scene = new THREE.Scene()
    sceneRef.current = scene

    // 2. Camera Setup
    const camera = new THREE.PerspectiveCamera(
      30.0,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      20.0
    )
    // 摄像机稍微往左偏移，镜头稍远
    camera.position.set(-0.15, 1.35, 1.8)
    cameraRef.current = camera

    // 3. Renderer Setup
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    })
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight)
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setClearColor(0x000000, 0)

    // 适配 Three.js 色彩空间 (v152+)
    // renderer.outputColorSpace = THREE.SRGBColorSpace

    containerRef.current.appendChild(renderer.domElement)
    rendererRef.current = renderer

    // 4. Lighting
    const light = new THREE.DirectionalLight(0xffffff, Math.PI)
    light.position.set(1.0, 1.0, 1.0).normalize()
    scene.add(light)

    const ambientLight = new THREE.AmbientLight(0x404040, 0.5)
    scene.add(ambientLight)

    // 添加接地投影 (Contact Shadow)
    const shadowGeometry = new THREE.PlaneGeometry(1.2, 1.2)
    const shadowCanvas = document.createElement('canvas')
    shadowCanvas.width = 256
    shadowCanvas.height = 256
    const context = shadowCanvas.getContext('2d')
    if (context) {
      const gradient = context.createRadialGradient(128, 128, 0, 128, 128, 128)
      // 中心较深，向外渐变为完全透明
      gradient.addColorStop(0, 'rgba(0, 0, 0, 0.25)')
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
      context.fillStyle = gradient
      context.fillRect(0, 0, 256, 256)
    }
    const shadowTexture = new THREE.CanvasTexture(shadowCanvas)
    const shadowMaterial = new THREE.MeshBasicMaterial({
      map: shadowTexture,
      transparent: true,
      depthWrite: false,
      opacity: 0.8
    })
    const shadowMesh = new THREE.Mesh(shadowGeometry, shadowMaterial)
    shadowMesh.rotation.x = -Math.PI / 2
    shadowMesh.position.y = 0.005 // 略微浮在地面上方避免 Z 轴冲突
    scene.add(shadowMesh)

    // 5. Controls
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.screenSpacePanning = true
    // 将控制器视线的聚焦中心也稍向左移，保持和摄像机平衡
    controls.target.set(-0.15, 1.35, 0.0)
    controls.enableRotate = true
    controls.enableZoom = true // 开启滚轮缩放
    controls.enablePan = true // 开启右键平移
    controls.update()

    // 6. VRM Loader
    const loader = new GLTFLoader()

    // Explicitly configure loaders to avoid blob URL revocation issues in React StrictMode

    loader.register((parser) => {
      return new VRMLoaderPlugin(parser)
    })

    console.log('[VRMViewer] Start loading VRM:', modelPath)
    
    // 增加一个预检，看看文件是否能被 fetch 到
    fetch(modelPath).then(res => {
      console.log(`[VRMViewer] Fetch pre-check for ${modelPath}:`, res.status, res.statusText);
    }).catch(err => {
      console.error(`[VRMViewer] Fetch pre-check failed for ${modelPath}:`, err);
    });

    loader.load(
      modelPath,
      (gltf) => {
        const vrm = gltf.userData.vrm as VRM
        if (!vrm) {
          setError('Failed to load VRM data from GLTF')
          return
        }

        // 旋转模型使其面向摄像机 (如果是 VRM 0.x 模型)
        VRMUtils.rotateVRM0(vrm)

        scene.add(vrm.scene)
        currentVrmRef.current = vrm

        // ===== 入场动画初始化 =====
        // 初始位置：从右后方走入
        vrm.scene.position.set(0.4, -0.15, -0.3)
        // 初始朝向：从右侧面转入（90°侧身）
        vrm.scene.rotation.y = Math.PI / 2
        // 所有网格透明度设为 0（渐现），同时记录原始透明度状态
        const matOriginals = new Map<THREE.Material, { transparent: boolean; opacity: number }>()
        vrm.scene.traverse((obj) => {
          const mesh = obj as THREE.Mesh
          if (mesh.isMesh) {
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
            mats.forEach(m => {
              matOriginals.set(m, { transparent: m.transparent, opacity: m.opacity })
              // 只对原本就是半透明的材质做淡入动画
              // 不透明的材质（眼睛、皮肤等）靠旋转被挙位自然隐藏，不动其 opacity
              if (m.transparent) {
                m.opacity = 0
              }
            })
          }
        })
        entranceRef.current = { active: true, elapsed: 0, duration: 2.0 }
          // 将原始状态绑定到 ref 上，供动画结束时还原
          ; (entranceRef.current as any).matOriginals = matOriginals
        // ==========================

        setLoading(false)

        console.log('[VRMViewer] Model Loaded:', vrm)

        if (vrm.humanoid) {
          const setBone = (name: any, x: number | null, y: number | null, z: number | null) => {
            const node = vrm.humanoid?.getNormalizedBoneNode(name)
            if (node) {
              if (x !== null) node.rotation.x = x
              if (y !== null) node.rotation.y = y
              if (z !== null) node.rotation.z = z
            }
          }

          // 肩膀微垂
          setBone('leftShoulder', 0, 0, -0.02)
          setBone('rightShoulder', 0, 0, 0.02)

          // 大臂
          setBone('leftUpperArm', 0.1, 0, -1.25)
          setBone('rightUpperArm', 0.1, 0, 1.25)

          // 让手指微弯
          flexFingers(vrm)
        }
      },
      (xhr) => {
        if (xhr.total > 0) {
          setProgress(Math.round((xhr.loaded / xhr.total) * 100))
        }
      },
      (error) => {
        console.error('[VRMViewer] Error loading VRM:', error)
        let errorMsg = 'Load failed';
        if (error instanceof Error) {
          errorMsg = error.message;
        } else if (error instanceof ProgressEvent) {
          const status = (error.target as XMLHttpRequest)?.status;
          errorMsg = `Network Error (Status: ${status || 'Unknown'})`;
        } else {
          errorMsg = `Error: ${String(error)}`;
        }
        setError(errorMsg)
        setLoading(false)
      }
    )

    // 7. Animation Loop
    const animate = () => {
      requestRef.current = requestAnimationFrame(animate)

      const deltaTime = clockRef.current.getDelta()
      const currentVrm = currentVrmRef.current

      if (currentVrm) {
        currentVrm.update(deltaTime)

        // === 入场动画 ===
        const entrance = entranceRef.current
        if (entrance.active) {
          entrance.elapsed += deltaTime
          const rawP = Math.min(entrance.elapsed / entrance.duration, 1)
          // easeInOutCubic: 慢启动 → 中途加速 → 缓慢落地，共 2.4 秒，动画感很明显
          const p = rawP < 0.5
            ? 4 * rawP * rawP * rawP
            : 1 - Math.pow(-2 * rawP + 2, 3) / 2

          // 位置：从 (0.4, -0.15, -0.3) 走到 (0, 0, 0)
          currentVrm.scene.position.set(
            0.4 * (1 - p),
            -0.15 * (1 - p),
            -0.3 * (1 - p)
          )

          // 旋转：从右侧面（Math.PI/2）缓缓转到正面（0）
          currentVrm.scene.rotation.y = (Math.PI / 2) * (1 - p)

          // 透明度：前 30% 时间内淡入，每个材质分别挖到它自己的原始 opacity
          const fadeP = Math.min(rawP / 0.3, 1)
          const matOriginals: Map<THREE.Material, { transparent: boolean; opacity: number }> =
            (entrance as any).matOriginals
          currentVrm.scene.traverse((obj) => {
            const mesh = obj as THREE.Mesh
            if (mesh.isMesh) {
              const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
              mats.forEach(m => {
                const orig = matOriginals?.get(m)
                // 只对原本就是半透明的材质做淡入；不透明材质不动（眼睛已可展示）
                if (orig?.transparent) {
                  m.opacity = orig.opacity * fadeP
                }
              })
            }
          })

          if (rawP >= 1) {
            // 动画完毕，还原每个材质的原始透明度状态（不能暴力全设为 false）
            entrance.active = false
            currentVrm.scene.position.set(0, 0, 0)
            currentVrm.scene.rotation.y = 0
            const matOriginals: Map<THREE.Material, { transparent: boolean; opacity: number }> =
              (entrance as any).matOriginals
            currentVrm.scene.traverse((obj) => {
              const mesh = obj as THREE.Mesh
              if (mesh.isMesh) {
                const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
                mats.forEach(m => {
                  const orig = matOriginals?.get(m)
                  if (orig) {
                    // 还原为模型原始状态（眼镜镜片等半透明材质保持 transparent=true）
                    m.transparent = orig.transparent
                    m.opacity = orig.opacity
                  } else {
                    m.opacity = 1
                    m.transparent = false
                  }
                })
              }
            })
          }
        }
        // === 入场动画结束 ===

        // 呼吸和自动摇摆感
        const t = clockRef.current.elapsedTime

        if (currentVrm.humanoid) {
          const chest = currentVrm.humanoid.getNormalizedBoneNode('chest')
          if (chest) {
            chest.rotation.z = Math.sin(t * 1.5) * 0.01
          }

          const head = currentVrm.humanoid.getNormalizedBoneNode('head')
          if (head) {
            head.rotation.y = Math.sin(t * 0.5) * 0.05
            head.rotation.x = Math.sin(t * 0.8) * 0.02
          }

          const leftUpperArm = currentVrm.humanoid.getNormalizedBoneNode('leftUpperArm')
          const rightUpperArm = currentVrm.humanoid.getNormalizedBoneNode('rightUpperArm')
          if (leftUpperArm) leftUpperArm.rotation.z = -1.25 + Math.sin(t * 1.5) * 0.01
          if (rightUpperArm) rightUpperArm.rotation.z = 1.25 - Math.sin(t * 1.5) * 0.01
        }

        // 眨眼
        const blinkBase = Math.sin(t * 0.5)
        if (currentVrm.expressionManager) {
          if (blinkBase > 0.9) {
            currentVrm.expressionManager.setValue('blink', (blinkBase - 0.9) * 10)
          } else {
            currentVrm.expressionManager.setValue('blink', 0)
          }
        }
      }

      renderer.render(scene, camera)
    }

    animate()

    // 8. Resize Handling
    handleResize = () => {
      if (!containerRef.current || !cameraRef.current || !rendererRef.current) return

      const width = containerRef.current.clientWidth
      const height = containerRef.current.clientHeight

      cameraRef.current.aspect = width / height
      cameraRef.current.updateProjectionMatrix()
      rendererRef.current.setSize(width, height)
    }

    window.addEventListener('resize', handleResize)

    } catch (e) {
      console.error('[VRMViewer] Setup Error:', e);
      setError(e instanceof Error ? e.message : String(e));
    }

    // Cleanup
    return () => {
      if (handleResize) {
        window.removeEventListener('resize', handleResize)
      }
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current)
      }
      if (rendererRef.current) {
        rendererRef.current.dispose()
      }
      if (containerRef.current && rendererRef.current) {
        containerRef.current.removeChild(rendererRef.current.domElement)
      }
    }
  }, [modelPath])

  return (
    <div className={`relative w-full h-full overflow-hidden ${className}`}>
      <div ref={containerRef} className="w-full h-full" />

      {loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/20 backdrop-blur-sm transition-opacity">
          <div className="text-sm font-medium text-zinc-400 mb-2">
            正在激活 EVA {progress > 0 ? `(${progress}%)` : ''}...
          </div>
          <div className="w-48 h-1 bg-zinc-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-violet-500 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-destructive/10 backdrop-blur-sm text-destructive p-6 text-center">
          <div>
            <p className="font-bold mb-1">EVA 核心激活失败</p>
            <p className="text-xs opacity-80">{error}</p>
          </div>
        </div>
      )}
    </div>
  )
}

function flexFingers(vrm: VRM) {
  const fingers = ['index', 'middle', 'ring', 'little']
  const bones = ['Proximal', 'Intermediate', 'Distal']

  const fingerStrengths: Record<string, number> = {
    index: 0.15,
    middle: 0.35,
    ring: 0.45,
    little: 0.5
  }

  fingers.forEach(finger => {
    const strength = fingerStrengths[finger]
    bones.forEach(bone => {
      const fingerName = finger.charAt(0).toUpperCase() + finger.slice(1)
      const leftBone = vrm.humanoid?.getNormalizedBoneNode(`left${fingerName}${bone}` as any)
      const rightBone = vrm.humanoid?.getNormalizedBoneNode(`right${fingerName}${bone}` as any)

      if (leftBone) leftBone.rotation.z = -strength
      if (rightBone) rightBone.rotation.z = strength
    })
  })

  // 大拇指更加自然的内扣
  const leftThumb = vrm.humanoid?.getNormalizedBoneNode('leftThumbProximal')
  const rightThumb = vrm.humanoid?.getNormalizedBoneNode('rightThumbProximal')
  if (leftThumb) {
    leftThumb.rotation.y = -0.3
    leftThumb.rotation.x = 0.2
  }
  if (rightThumb) {
    rightThumb.rotation.y = 0.3
    rightThumb.rotation.x = 0.2
  }
}
