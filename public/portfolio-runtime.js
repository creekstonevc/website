(() => {
        if (window.__CREEKSTONE_RUNTIME_STARTED__) return;
        window.__CREEKSTONE_RUNTIME_STARTED__ = true;

        gsap.registerPlugin(ScrollTrigger);

        const targetMark = {
            x: 0, y: 0,              
            scale: 0.85,             
            r: 232, g: 184, b: 47,
            rotIntensity: 0.05       
        };
        let isTimelineMarkActive = false;
        let triggerMarkPulse = () => {};
        let revealHomepageMark = () => {};
        let loaderHasExited = false;

        const revealLoader = () => {
            const loader = document.getElementById("loader");
            if (!loader) return;

            if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
                gsap.set(loader, { display: "none" });
                loaderHasExited = true;
                revealHomepageMark();
                return;
            }

            gsap.set(".loader-frame-line", { scaleY: 0 });
            gsap.set([".loader-frame-index", ".loader-frame-status"], { autoAlpha: 0 });
            gsap.set(".loader-particle-ring", { autoAlpha: 0, scale: 0.78 });
            gsap.set(".loader-mark-primary", { autoAlpha: 0, scale: 0.64, rotation: -18, filter: "blur(10px)" });
            gsap.set(".loader-mark-echo", { autoAlpha: 0, scale: 1.5, rotation: 22 });
            gsap.set(".loader-wordmark", { autoAlpha: 0, yPercent: 112 });
            gsap.set(".loader-progress-fill", { scaleX: 0 });
            gsap.set(".loader-thesis", { autoAlpha: 0, y: 12, filter: "blur(6px)" });

            const tlLoader = gsap.timeline({
                defaults: { ease: "expo.out" },
                onComplete: () => {
                    gsap.set(loader, { display: "none" });
                    loaderHasExited = true;
                    revealHomepageMark();
                }
            });

            tlLoader
                .to(".loader-frame-line", { scaleY: 1, duration: 0.75, stagger: 0.08 }, 0)
                .to([".loader-frame-index", ".loader-frame-status"], { autoAlpha: 1, duration: 0.45, stagger: 0.08 }, 0.08)
                .to(".loader-particle-ring", { autoAlpha: 1, scale: 1, duration: 0.75, stagger: 0.08 }, 0.08)
                .to(".loader-mark-primary", {
                    autoAlpha: 1,
                    scale: 1,
                    rotation: 0,
                    filter: "blur(0px)",
                    duration: 0.78
                }, 0.12)
                .to(".loader-mark-echo", { autoAlpha: 0.32, scale: 1.08, rotation: 0, duration: 0.62 }, 0.18)
                .to(".loader-mark-echo", { autoAlpha: 0, scale: 0.96, duration: 0.38 }, 0.58)
                .to(".loader-wordmark", { autoAlpha: 1, yPercent: 0, duration: 0.72 }, 0.36)
                .to(".loader-progress-fill", { scaleX: 1, duration: 0.95, ease: "power2.inOut" }, 0.52)
                .to(".loader-thesis", { autoAlpha: 1, y: 0, filter: "blur(0px)", duration: 0.58 }, 0.62)
                .to(".loader-content", {
                    scale: 0.965,
                    autoAlpha: 0,
                    filter: "blur(8px)",
                    duration: 0.42,
                    ease: "power3.in"
                }, 1.58)
                .to([".loader-frame", ".loader-frame-status", ".loader-frame-index"], {
                    autoAlpha: 0,
                    duration: 0.28,
                    ease: "power2.in"
                }, 1.62)
                .to(loader, {
                    clipPath: "inset(0 0 100% 0)",
                    duration: 0.72,
                    ease: "power4.inOut"
                }, 1.72);
        };
        if (document.readyState === "complete") revealLoader();
        else window.addEventListener("load", revealLoader, { once: true });

        const lenis = new Lenis({ duration: 1.2, smooth: true });
        lenis.on('scroll', ScrollTrigger.update);
        gsap.ticker.add((time)=>{ lenis.raf(time * 1000) });
        gsap.ticker.lagSmoothing(0, 0);

        // Establish the full-screen hold zones before any downstream scene trigger
        // measures its start position. Scroll first charges the current chapter;
        // only a complete charge releases the document toward the next chapter.
        const chapterHoldTriggers = new Map();
        const createChapterHoldTrigger = (selector) => {
            const element = document.querySelector(selector);
            if (!element || chapterHoldTriggers.has(selector)) return;
            const trigger = ScrollTrigger.create({
                trigger: element,
                start: 'top top',
                end: () => '+=' + Math.max(Math.round(window.innerHeight * 0.72), 480),
                pin: true,
                pinSpacing: true,
                anticipatePin: 1,
                invalidateOnRefresh: true
            });
            chapterHoldTriggers.set(selector, trigger);
        };
        ['#hero', '#ai-vc-agent'].forEach(createChapterHoldTrigger);

        const cursorDot = document.getElementById('cursor-dot');
        const cursorRing = document.getElementById('cursor-ring');
        let mouseX = window.innerWidth / 2, mouseY = window.innerHeight / 2;
        let ringX = mouseX, ringY = mouseY;

        document.addEventListener('mousemove', (e) => {
            mouseX = e.clientX; mouseY = e.clientY;
            cursorDot.style.left = mouseX + 'px'; cursorDot.style.top = mouseY + 'px';
            
            if(e.target.closest('a') || e.target.closest('button') || e.target.closest('.hover-underline') || e.target.closest('.hover-card') || e.target.closest('.aw-bubble') || e.target.closest('.pixel-card') || e.target.closest('.folder-card')) {
                cursorRing.style.width = '50px'; cursorRing.style.height = '50px';
                cursorRing.style.backgroundColor = 'rgba(255,255,255,0.1)';
                if(e.target.closest('#aw-container')) cursorRing.style.backgroundColor = 'rgba(0,0,0,0.05)';
            } else {
                cursorRing.style.width = '40px'; cursorRing.style.height = '40px';
                cursorRing.style.backgroundColor = 'transparent';
            }
        });

        gsap.ticker.add(() => {
            ringX += (mouseX - ringX) * 0.15; ringY += (mouseY - ringY) * 0.15;
            cursorRing.style.left = ringX + 'px'; cursorRing.style.top = ringY + 'px';
        });

        // CREEKSTONE 3D PARTICLE MARK
        const container = document.getElementById('webgl-container');
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
        camera.position.z = 150; 
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        container.appendChild(renderer.domElement);
        
        function createMarkGeometryFromPixels(pixels, bounds, particleCount) {
            const geometry = new THREE.BufferGeometry();
            const positions = [];
            const colors = [];
            const randoms = [];
            const layers = [];
            const phases = [];
            const centerX = (bounds.minX + bounds.maxX) / 2;
            const centerY = (bounds.minY + bounds.maxY) / 2;
            const sourceSize = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
            const markScale = 94 / Math.max(sourceSize, 1);

            for (let i = 0; i < particleCount; i += 1) {
                const pixel = pixels[Math.floor(Math.random() * pixels.length)];
                const x = (pixel.x - centerX + (Math.random() - 0.5) * 0.9) * markScale;
                const y = -(pixel.y - centerY + (Math.random() - 0.5) * 0.9) * markScale;
                const radial = Math.min(Math.sqrt(x * x + y * y) / 47, 1);
                const layer = radial < 0.52 ? 0 : radial < 0.76 ? 1 : 2;
                const phase = Math.random();
                const z =
                    (layer - 1) * 3.4 +
                    Math.sin(Math.atan2(y, x) * 3 + radial * 8) * 1.25 +
                    (Math.random() - 0.5) * 2.4;

                positions.push(x, y, z);
                colors.push(pixel.r / 255, pixel.g / 255, pixel.b / 255);
                randoms.push(Math.random());
                layers.push(layer);
                phases.push(phase);
            }

            geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
            geometry.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3));
            geometry.setAttribute('aRandom', new THREE.Float32BufferAttribute(randoms, 1));
            geometry.setAttribute('aLayer', new THREE.Float32BufferAttribute(layers, 1));
            geometry.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases, 1));
            return geometry;
        }

        function createFallbackMarkGeometry(particleCount) {
            const pixels = [];
            const bounds = { minX: 0, minY: 0, maxX: 200, maxY: 200 };
            for (let i = 0; i < particleCount; i += 1) {
                const layer = i % 3;
                const angle = Math.random() * Math.PI * 2;
                const radius = 58 + layer * 18 + (Math.random() - 0.5) * (17 - layer * 3);
                const taper = 1 - Math.max(0, Math.cos(angle + layer * 0.72)) * 0.16;
                pixels.push({
                    x: 100 + Math.cos(angle) * radius * taper,
                    y: 100 + Math.sin(angle) * radius,
                    r: 229,
                    g: 189,
                    b: 82
                });
            }
            return createMarkGeometryFromPixels(pixels, bounds, particleCount);
        }

        const vertexShader = `
            uniform float uTime;
            uniform float uPulse;
            uniform float uAssemble;
            uniform float uPointScale;
            attribute vec3 aColor;
            attribute float aRandom;
            attribute float aLayer;
            attribute float aPhase;
            varying vec3 vColor;
            varying float vDepth;
            varying float vSpark;
            varying float vFlow;

            void main() {
                vec3 pos = position;
                float radius = length(pos.xy);
                float phase = aPhase * 6.283185;
                float scatter = (1.0 - uAssemble) * (20.0 + aRandom * 52.0);
                pos.xy += vec2(cos(phase), sin(phase)) * scatter;
                pos.z += (aRandom - 0.5) * (1.0 - uAssemble) * 72.0;

                float angle = atan(pos.y, pos.x);
                float flowWave = sin(angle * 3.0 - uTime * 1.25 + aLayer * 1.72 + radius * 0.045);
                float reverseWave = sin(angle * -2.0 - uTime * 0.72 + aLayer * 2.35);
                float flowHead = pow(max(0.0, flowWave), 8.0);
                float secondaryHead = pow(max(0.0, reverseWave), 12.0);
                vec2 tangent = normalize(vec2(-pos.y, pos.x) + vec2(0.0001));
                float tangentDrift = sin(angle * 5.0 - uTime * 1.05 + aLayer) * 0.11;
                pos.xy += tangent * tangentDrift;

                float coherentBreath = 1.0 + sin(uTime * 0.68) * 0.004;
                pos.xy *= coherentBreath * (1.0 + uPulse * 0.045);
                pos.z += sin(angle * 4.0 - uTime * 0.92 + aLayer * 1.4) * (0.52 + aLayer * 0.16);
                pos.z += (aRandom - 0.5) * uPulse * 10.0;

                vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                vDepth = -mvPosition.z;
                vColor = aColor;
                vFlow = clamp(flowHead + secondaryHead * 0.45, 0.0, 1.0);
                vSpark = 0.78 + aRandom * 0.18 + vFlow * 0.58 + uPulse * 0.28;
                gl_PointSize = (1.0 + aRandom * 1.35 + vFlow * 0.72) * uPointScale * (158.0 / max(vDepth, 1.0));
                gl_Position = projectionMatrix * mvPosition;
            }
        `;

        const fragmentShader = `
            uniform vec3 uTone;
            uniform float uToneMix;
            uniform float uOpacity;
            varying vec3 vColor;
            varying float vDepth;
            varying float vSpark;
            varying float vFlow;

            void main() {
                float distanceToCenter = distance(gl_PointCoord, vec2(0.5));
                if (distanceToCenter > 0.5) discard;
                float particle = smoothstep(0.5, 0.08, distanceToCenter);
                float depth = smoothstep(205.0, 72.0, vDepth);
                vec3 color = mix(vColor, uTone, uToneMix);
                color = mix(color, vec3(1.0, 0.84, 0.38), vFlow * 0.38);
                gl_FragColor = vec4(color, particle * depth * uOpacity * vSpark);
            }
        `;

        function createMarkMaterial({ pointScale, opacity, blending }) {
            return new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uPulse: { value: 0 },
                    uAssemble: { value: 0 },
                    uPointScale: { value: pointScale },
                    uTone: { value: new THREE.Color('#9a690e') },
                    uToneMix: { value: 0.9 },
                    uOpacity: { value: opacity }
                },
                vertexShader,
                fragmentShader,
                transparent: true,
                depthWrite: false,
                blending
            });
        }

        const initialParticleCount = window.innerWidth < 768 ? 10000 : 14000;
        let markGeometry = createFallbackMarkGeometry(initialParticleCount);
        const material = createMarkMaterial({
            pointScale: 1.65,
            opacity: 0,
            blending: THREE.NormalBlending
        });
        const auraMaterial = createMarkMaterial({
            pointScale: 3.2,
            opacity: 0,
            blending: THREE.NormalBlending
        });
        const markMesh = new THREE.Points(markGeometry, material);
        const auraMesh = new THREE.Points(markGeometry, auraMaterial);
        const markGroup = new THREE.Group();
        markGroup.add(auraMesh);
        markGroup.add(markMesh);
        markGroup.scale.set(0.85, 0.85, 0.85);
        scene.add(markGroup);

        let markAssetReady = false;
        let markRevealStarted = false;
        revealHomepageMark = () => {
            if (!loaderHasExited || !markAssetReady || markRevealStarted) return;
            markRevealStarted = true;

            gsap.timeline({ delay: 0.42 })
                .to([material.uniforms.uAssemble, auraMaterial.uniforms.uAssemble], {
                    value: 1,
                    duration: 0.82,
                    ease: 'expo.out'
                })
                .to(material.uniforms.uOpacity, {
                    value: 0.96,
                    duration: 0.78,
                    ease: 'power2.out'
                }, 0.08)
                .to(auraMaterial.uniforms.uOpacity, {
                    value: 0.28,
                    duration: 0.86,
                    ease: 'power2.out'
                }, 0.14)
                .call(triggerMarkPulse, [], 0.58);
        };

        const markImage = new Image();
        markImage.decoding = 'async';
        markImage.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = markImage.naturalWidth;
            canvas.height = markImage.naturalHeight;
            const context = canvas.getContext('2d', { willReadFrequently: true });
            if (!context) return;
            context.drawImage(markImage, 0, 0);
            const imageData = context.getImageData(0, 0, canvas.width, canvas.height).data;
            const pixels = [];
            const bounds = { minX: canvas.width, minY: canvas.height, maxX: 0, maxY: 0 };

            for (let y = 0; y < canvas.height; y += 1) {
                for (let x = 0; x < canvas.width; x += 1) {
                    const index = (y * canvas.width + x) * 4;
                    const r = imageData[index];
                    const g = imageData[index + 1];
                    const b = imageData[index + 2];
                    const alpha = imageData[index + 3];
                    const isCreekstoneGold = alpha > 24 && r > 120 && g > 75 && r > b * 1.35;
                    if (!isCreekstoneGold) continue;
                    pixels.push({ x, y, r, g, b });
                    bounds.minX = Math.min(bounds.minX, x);
                    bounds.minY = Math.min(bounds.minY, y);
                    bounds.maxX = Math.max(bounds.maxX, x);
                    bounds.maxY = Math.max(bounds.maxY, y);
                }
            }

            if (!pixels.length) return;
            const sampledGeometry = createMarkGeometryFromPixels(pixels, bounds, initialParticleCount);
            markMesh.geometry = sampledGeometry;
            auraMesh.geometry = sampledGeometry;
            markGeometry.dispose();
            markGeometry = sampledGeometry;
            markAssetReady = true;
            revealHomepageMark();
        };
        markImage.onerror = () => {
            markAssetReady = true;
            revealHomepageMark();
        };
        markImage.src = '/creekstone-mark.png';
        
        let targetRotX = 0, targetRotY = 0;
        const pointerNDC = new THREE.Vector2(0, 0);
        document.addEventListener('mousemove', (e) => {
            pointerNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
            pointerNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
        });

        let isPulsing = false;
        triggerMarkPulse = () => {
            if (isPulsing) return;
            isPulsing = true;
            gsap.timeline({
                onComplete: () => { isPulsing = false; }
            })
                .to([material.uniforms.uPulse, auraMaterial.uniforms.uPulse], {
                    value: 1,
                    duration: 0.18,
                    ease: 'power3.out'
                })
                .to([material.uniforms.uPulse, auraMaterial.uniforms.uPulse], {
                    value: 0,
                    duration: 0.72,
                    ease: 'expo.out'
                });
        };
        const clock = new THREE.Clock();
        const rayPoint = new THREE.Vector3();
        const rayDir = new THREE.Vector3();
        const targetPoint = new THREE.Vector3();
        const markWorldPos = new THREE.Vector3();
        const cameraForward = new THREE.Vector3();
        const pointerPlane = new THREE.Plane();
        const pointerRay = new THREE.Ray();
        const lookAhead = 70;
        function animate() {
            requestAnimationFrame(animate);
            if (document.hidden) return;
            const elapsed = clock.getElapsedTime();
            material.uniforms.uTime.value = elapsed;
            auraMaterial.uniforms.uTime.value = elapsed;
            
            markGroup.position.x += (targetMark.x - markGroup.position.x) * 0.05;
            markGroup.position.y += (targetMark.y - markGroup.position.y) * 0.05;
            
            const currentScale = markGroup.scale.x + (targetMark.scale - markGroup.scale.x) * 0.08;
            markGroup.scale.set(currentScale, currentScale, currentScale);
            
            const tone = new THREE.Color(targetMark.r / 255, targetMark.g / 255, targetMark.b / 255);
            material.uniforms.uTone.value.lerp(tone, 0.08);
            auraMaterial.uniforms.uTone.value.lerp(tone, 0.08);

            rayPoint.set(pointerNDC.x, pointerNDC.y, 0.5).unproject(camera);
            rayDir.copy(rayPoint).sub(camera.position).normalize();
            markGroup.getWorldPosition(markWorldPos);
            camera.getWorldDirection(cameraForward);
            pointerPlane.setFromNormalAndCoplanarPoint(
                cameraForward,
                targetPoint.copy(markWorldPos).addScaledVector(cameraForward, -lookAhead)
            );
            pointerRay.set(camera.position, rayDir);
            if (pointerRay.intersectPlane(pointerPlane, targetPoint)) {
                const dx = targetPoint.x - markWorldPos.x;
                const dy = targetPoint.y - markWorldPos.y;
                targetRotY = THREE.MathUtils.clamp(Math.atan2(dx, lookAhead), -0.14, 0.14);
                targetRotX = THREE.MathUtils.clamp(-Math.atan2(dy, lookAhead), -0.14, 0.14);
            }

            markGroup.rotation.y += (targetRotY - markGroup.rotation.y) * targetMark.rotIntensity;
            markGroup.rotation.x += (targetRotX - markGroup.rotation.x) * targetMark.rotIntensity;
            markGroup.rotation.z += (0 - markGroup.rotation.z) * 0.08;

            renderer.render(scene, camera); 
        }
        animate();
        
        window.addEventListener('resize', () => { 
            camera.aspect = window.innerWidth / window.innerHeight; 
            camera.updateProjectionMatrix(); 
            renderer.setSize(window.innerWidth, window.innerHeight); 
        });

        const globalBackground = document.getElementById("global-bg");
        const heroMarkState = {
            x: 0,
            y: 0,
            scale: 0.85,
            r: 232,
            g: 184,
            b: 47,
            rotIntensity: 0.05
        };

        function restoreHeroScene(immediate = false) {
            gsap.killTweensOf([
                globalBackground,
                targetMark,
                material.uniforms.uOpacity,
                auraMaterial.uniforms.uOpacity
            ]);

            if (immediate) {
                gsap.set(globalBackground, { backgroundColor: "#f3efe5" });
                gsap.set(targetMark, heroMarkState);
                material.uniforms.uOpacity.value = 0.96;
                auraMaterial.uniforms.uOpacity.value = 0.28;
                material.uniforms.uTone.value.set("#e8b82f");
                auraMaterial.uniforms.uTone.value.set("#e8b82f");
                markGroup.position.set(0, 0, 0);
                markGroup.scale.set(heroMarkState.scale, heroMarkState.scale, heroMarkState.scale);
                markGroup.rotation.set(0, 0, 0);
                targetRotX = 0;
                targetRotY = 0;
                return;
            }

            gsap.to(globalBackground, {
                backgroundColor: "#f3efe5",
                duration: 0.8,
                overwrite: true
            });
            gsap.to(targetMark, {
                ...heroMarkState,
                duration: 1,
                ease: "power3.out",
                overwrite: true
            });
            gsap.to(material.uniforms.uOpacity, {
                value: 0.96,
                duration: 0.8,
                overwrite: true
            });
            gsap.to(auraMaterial.uniforms.uOpacity, {
                value: 0.28,
                duration: 0.8,
                overwrite: true
            });
        }

        // CREEKSTONE MARK SCROLL TRIGGERS
        ScrollTrigger.create({
            trigger: ".hero-section",
            start: "top center",
            onEnter: () => restoreHeroScene(),
            onEnterBack: () => restoreHeroScene()
        });

        // CREEKSTONE AI VC AGENT — RUNTIME CHAMBER CUT-IN
        const agentSection = document.getElementById("ai-vc-agent");
        const agentConsole = agentSection?.querySelector(".agent-console");
        if (agentSection && agentConsole) {
            const reduceAgentMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

            if (!reduceAgentMotion) {
                gsap.set(".agent-curtain", { autoAlpha: 1, scaleY: 0 });
                gsap.set(".agent-index span", { autoAlpha: 0, y: -12 });
                gsap.set(".agent-field-axis-a", { scaleX: 0 });
                gsap.set(".agent-field-axis-b", { scaleY: 0 });
                gsap.set(".agent-field-node", { autoAlpha: 0, scale: 0.35 });
                gsap.set(".agent-core-ring", { autoAlpha: 0, scale: 0.55 });
                gsap.set(".agent-core-cross", { autoAlpha: 0, scale: 0.35 });
                gsap.set(".agent-core-label", { autoAlpha: 0, x: 18 });
                gsap.set(".agent-title-line", { yPercent: 112, rotation: 1.2, filter: "blur(9px)" });
                gsap.set(".agent-intro", { autoAlpha: 0, y: 26, filter: "blur(7px)" });
                gsap.set(".agent-verbs span", { autoAlpha: 0, x: -24 });
                gsap.set(".agent-portrait-shell", {
                    autoAlpha: 0,
                    xPercent: 46,
                    y: -64,
                    rotationY: -38,
                    rotationZ: 7,
                    scale: 0.78,
                    filter: "blur(8px)"
                });
                gsap.set(".agent-portrait", { scale: 1.16 });
                gsap.set(".agent-console", {
                    clipPath: "inset(100% 0 0 0)",
                    y: 70,
                    filter: "blur(8px)"
                });
                gsap.set(".agent-console-scan", { autoAlpha: 0, x: 0 });

                const agentCutIn = gsap.timeline({
                    paused: true,
                    defaults: { ease: "expo.out" }
                });

                agentCutIn
                    .to(".agent-curtain", {
                        scaleY: 1,
                        duration: 0.42,
                        stagger: 0.04,
                        ease: "power4.inOut"
                    }, 0)
                    .to(".agent-curtain", {
                        autoAlpha: 0,
                        duration: 0.32,
                        stagger: 0.03,
                        ease: "power2.out"
                    }, 0.48)
                    .to(".agent-index span", { autoAlpha: 1, y: 0, duration: 0.48, stagger: 0.08 }, 0.5)
                    .to(".agent-field-axis-a", { scaleX: 1, duration: 0.72 }, 0.54)
                    .to(".agent-field-axis-b", { scaleY: 1, duration: 0.72 }, 0.58)
                    .to(".agent-field-node", { autoAlpha: 1, scale: 1, duration: 0.56, stagger: 0.1 }, 0.64)
                    .to(".agent-core-ring", {
                        autoAlpha: 1,
                        scale: 1,
                        duration: 0.82,
                        stagger: 0.08
                    }, 0.62)
                    .to(".agent-core-cross", {
                        autoAlpha: 1,
                        scale: 1,
                        duration: 0.68,
                        stagger: 0.08
                    }, 0.7)
                    .to(".agent-core-label", { autoAlpha: 1, x: 0, duration: 0.5 }, 0.9)
                    .to(".agent-title-line", {
                        yPercent: 0,
                        rotation: 0,
                        filter: "blur(0px)",
                        duration: 0.82,
                        stagger: 0.11
                    }, 0.58)
                    .to(".agent-portrait-shell", {
                        autoAlpha: 1,
                        xPercent: 0,
                        y: 0,
                        rotationY: 0,
                        rotationZ: 0,
                        scale: 1,
                        filter: "blur(0px)",
                        duration: 0.92,
                        ease: "power4.out"
                    }, 0.72)
                    .to(".agent-portrait", { scale: 1.035, duration: 1.1, ease: "power3.out" }, 0.78)
                    .to(".agent-intro", {
                        autoAlpha: 1,
                        y: 0,
                        filter: "blur(0px)",
                        duration: 0.58
                    }, 0.92)
                    .to(".agent-verbs span", {
                        autoAlpha: 1,
                        x: 0,
                        duration: 0.5,
                        stagger: 0.08
                    }, 1.16)
                    .to(".agent-console", {
                        clipPath: "inset(0 0% 0 0)",
                        y: 0,
                        filter: "blur(0px)",
                        duration: 0.88,
                        ease: "power4.inOut"
                    }, 0.98)
                    .set(".agent-console-scan", { autoAlpha: 0.9 }, 1.12)
                    .to(".agent-console-scan", {
                        x: () => agentConsole.clientWidth,
                        duration: 0.78,
                        ease: "power2.inOut"
                    }, 1.12)
                    .to(".agent-console-scan", { autoAlpha: 0, duration: 0.2 }, 1.8)
                    .call(triggerMarkPulse, null, 0.7);

                ScrollTrigger.create({
                    trigger: agentSection,
                    start: "top 72%",
                    once: true,
                    onEnter: () => {
                        gsap.to("#global-bg", { backgroundColor: "#030303", duration: 0.5 });
                        agentCutIn.play();
                    }
                });
            }

            const showAgentMark = (fromHero = false) => {
                gsap.to("#global-bg", { backgroundColor: "#030303", duration: 0.8 });
                material.uniforms.uOpacity.value = 1;
                auraMaterial.uniforms.uOpacity.value = 0.15;
                if (fromHero) {
                    material.uniforms.uTone.value.set('#9a690e');
                    auraMaterial.uniforms.uTone.value.set('#9a690e');
                    gsap.set(targetMark, { r: 154, g: 105, b: 14 });
                }
                gsap.to(targetMark, {
                    x: 0,
                    y: -4,
                    scale: 0.74,
                    r: 229,
                    g: 189,
                    b: 82,
                    rotIntensity: 0.12,
                    duration: 1.25,
                    ease: "power3.out"
                });
            };

            ScrollTrigger.create({
                trigger: agentSection,
                start: "top center",
                end: "bottom center",
                onEnter: () => showAgentMark(true),
                onEnterBack: () => showAgentMark(false),
                onLeaveBack: () => restoreHeroScene()
            });
        }

        const timelineMarkConfig = {
            baseX: 72, baseY: 40, radiusX: 18, radiusY: 10, turns: 1.7,
            curiosityWindow: 0.045, curiosityPush: 3,
            baseRot: 0.018, curiosityRot: 0.035
        };
        let timelineNodeProgresses = [];
        let timelineMarkXTo = () => {};
        let timelineMarkYTo = () => {};
        let timelineMarkRotTo = () => {};

        function createTimelineMarkSetters() {
            timelineMarkXTo = gsap.quickTo(targetMark, "x", {
                duration: 0.48,
                ease: "power3.out",
                overwrite: "auto"
            });
            timelineMarkYTo = gsap.quickTo(targetMark, "y", {
                duration: 0.48,
                ease: "power3.out",
                overwrite: "auto"
            });
            timelineMarkRotTo = gsap.quickTo(targetMark, "rotIntensity", {
                duration: 0.42,
                ease: "power2.out",
                overwrite: "auto"
            });
        }

        function setTimelineMarkActive(active, force = false) {
            if (!force && active === isTimelineMarkActive) return;
            isTimelineMarkActive = active;
            if (active) {
                // Entering from above can overlap the Agent mark's longer exit
                // tween. Clear only its spatial properties, then establish the
                // same deterministic Timeline position in both directions.
                gsap.killTweensOf(targetMark, "x,y,scale,rotIntensity");
                createTimelineMarkSetters();
                timelineMarkXTo(timelineMarkConfig.baseX);
                timelineMarkYTo(timelineMarkConfig.baseY);
                timelineMarkRotTo(timelineMarkConfig.baseRot);
                gsap.to(targetMark, {
                    scale: 0.45,
                    duration: 0.9,
                    ease: "power2.out",
                    overwrite: "auto"
                });
                return;
            }
            gsap.killTweensOf(targetMark, "x,y,rotIntensity");
        }

        function getNearestTimelineNode(progress) {
            if (!timelineNodeProgresses.length) return { index: -1, distance: 1 };
            let nearestIndex = -1; let nearestDistance = Infinity;
            for (let i = 0; i < timelineNodeProgresses.length; i += 1) {
                const distance = Math.abs(progress - timelineNodeProgresses[i]);
                if (distance < nearestDistance) { nearestDistance = distance; nearestIndex = i; }
            }
            return { index: nearestIndex, distance: nearestDistance };
        }

        function updateTimelineMarkMotion(progress) {
            if (!isTimelineMarkActive) return;
            const orbitPhase = progress * timelineMarkConfig.turns * Math.PI * 2;
            const orbitX = timelineMarkConfig.baseX + Math.cos(orbitPhase) * timelineMarkConfig.radiusX;
            const orbitY = timelineMarkConfig.baseY + Math.sin(orbitPhase + Math.PI / 3) * timelineMarkConfig.radiusY;

            const nearestNode = getNearestTimelineNode(progress);
            const curiosityStrength = Math.max(0, 1 - nearestNode.distance / timelineMarkConfig.curiosityWindow);
            const curiosityPhase = progress * 18;
            const curiosityX = Math.cos(curiosityPhase) * timelineMarkConfig.curiosityPush * curiosityStrength;
            const curiosityY = Math.sin(curiosityPhase * 1.1) * timelineMarkConfig.curiosityPush * 0.45 * curiosityStrength;

            timelineMarkXTo(orbitX + curiosityX);
            timelineMarkYTo(orbitY + curiosityY);

            const targetRotIntensity = timelineMarkConfig.baseRot + (timelineMarkConfig.curiosityRot - timelineMarkConfig.baseRot) * curiosityStrength;
            timelineMarkRotTo(targetRotIntensity);
        }

        const tlContainer = document.getElementById('timeline-container');
        const hWrap = document.getElementById('horizontal-wrap');
        const portfolioCounter = document.querySelector('.portfolio-counter');
        const portfolioCounterReel = document.getElementById('portfolio-counter-reel');
        const portfolioCounterRows = portfolioCounterReel
            ? Array.from(portfolioCounterReel.querySelectorAll('.portfolio-counter-number'))
            : [];
        let scrollWidth = hWrap.scrollWidth - window.innerWidth;
        const timelineNodes = Array.from(hWrap.querySelectorAll('.timeline-node'));
        let timelineAnchors = [];
        let activePortfolioIndex = -1;

        function buildTimelineAnchors() {
            scrollWidth = hWrap.scrollWidth - window.innerWidth;
            const safeScrollWidth = Math.max(scrollWidth, 1);
            const viewportCenter = window.innerWidth / 2;
            const nodeAnchors = timelineNodes.map((node, fallbackIndex) => {
                const nodeCenter = node.offsetLeft + node.offsetWidth / 2;
                const rawProgress = (nodeCenter - viewportCenter) / safeScrollWidth;
                const progress = Math.min(Math.max(rawProgress, 0), 1);
                const parsedIndex = Number.parseInt(node.dataset.timelineIndex || '', 10);
                return {
                    progress,
                    index: Number.isFinite(parsedIndex) ? parsedIndex : fallbackIndex
                };
            });
            nodeAnchors.sort((a, b) => a.progress - b.progress);
            timelineNodeProgresses = nodeAnchors.map((anchor) => anchor.progress);
            timelineAnchors = nodeAnchors;
            if (activePortfolioIndex >= 0) setPortfolioCounter(activePortfolioIndex, true);
        }

        function getPortfolioIndexByProgress(progress) {
            if (!timelineAnchors.length) return 0;
            let activeIndex = timelineAnchors[0].index;
            for (let i = 1; i < timelineAnchors.length; i += 1) {
                const threshold = (timelineAnchors[i - 1].progress + timelineAnchors[i].progress) / 2;
                if (progress < threshold) break;
                activeIndex = timelineAnchors[i].index;
            }
            return activeIndex;
        }

        function setPortfolioCounter(index, immediate = false) {
            if (!portfolioCounterReel || !portfolioCounterRows.length) return;
            const safeIndex = Math.min(Math.max(index, 0), portfolioCounterRows.length - 1);
            const rowHeight = portfolioCounterRows[0].getBoundingClientRect().height;
            const shouldAnimate =
                !immediate &&
                safeIndex !== activePortfolioIndex &&
                !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            activePortfolioIndex = safeIndex;
            gsap.to(portfolioCounterReel, {
                y: -safeIndex * rowHeight,
                duration: shouldAnimate ? 0.52 : 0,
                ease: shouldAnimate ? "power4.out" : "none",
                overwrite: true
            });
        }

        function updatePortfolioNodeState(index) {
            timelineNodes.forEach((node, nodeIndex) => {
                node.classList.toggle('is-active', nodeIndex === index);
                node.classList.toggle('is-past', nodeIndex < index);
                node.classList.toggle('is-upcoming', nodeIndex > index);
            });
        }

        buildTimelineAnchors();
        setPortfolioCounter(0, true);
        updatePortfolioNodeState(0);

        const enterTimelineScene = () => {
            setTimelineMarkActive(true, true);
            gsap.to("#global-bg", {
                backgroundColor: "#050505",
                duration: 0.35,
                overwrite: true
            });
            gsap.to(targetMark, {
                r: 241,
                g: 199,
                b: 90,
                duration: 0.5,
                ease: "power2.out",
                overwrite: "auto"
            });
            material.uniforms.uOpacity.value = 1;
            auraMaterial.uniforms.uOpacity.value = 0.15;
        };
        
        let tlTimeline = gsap.timeline({
            scrollTrigger: {
                trigger: tlContainer, pin: true, scrub: true, end: () => "+=" + scrollWidth,
                onEnter: enterTimelineScene,
                onEnterBack: enterTimelineScene,
                onLeave: () => setTimelineMarkActive(false),
                onLeaveBack: () => {
                    setTimelineMarkActive(false);
                    gsap.to("#global-bg", { backgroundColor: "#030303", duration: 0.45 });
                    gsap.to(targetMark, {
                        x: 0,
                        y: -4,
                        scale: 0.74,
                        r: 229,
                        g: 189,
                        b: 82,
                        rotIntensity: 0.12,
                        duration: 0.8,
                        ease: "power2.out"
                    });
                },
                onUpdate: (self) => {
                    const progress = Math.min(Math.max(self.progress, 0), 1);
                    const portfolioIndex = getPortfolioIndexByProgress(progress);
                    if (portfolioIndex !== activePortfolioIndex) {
                        setPortfolioCounter(portfolioIndex);
                        updatePortfolioNodeState(portfolioIndex);
                    }
                    updateTimelineMarkMotion(progress);
                }
            }
        });
        tlTimeline.to(hWrap, { x: -scrollWidth, ease: "none", duration: 1 }, 0);
        if (portfolioCounter) {
            tlTimeline.to(portfolioCounter, { opacity: 0, ease: "power1.inOut", duration: 0.06 }, 0.94);
        }
        window.addEventListener('resize', () => {
            buildTimelineAnchors();
            ScrollTrigger.refresh();
        });

        // Downstream holds must be measured only after Timeline has inserted its
        // own horizontal pin spacing. Otherwise they can activate inside Timeline.
        ['#projects-section', '#ecosystem-section'].forEach(createChapterHoldTrigger);
        ScrollTrigger.sort();

        ScrollTrigger.create({
            trigger: "#projects-section",
            start: "top center",
            onEnter: () => {
                gsap.to("#global-bg", { backgroundColor: "#030303", duration: 1 });
                gsap.to(targetMark, { x: 0, y: 40, scale: 0.7, r: 229, g: 189, b: 82, rotIntensity: 0.08, duration: 1.5, ease: "power3.out" });
                material.uniforms.uOpacity.value = 1;
                auraMaterial.uniforms.uOpacity.value = 0.15;
            },
            onLeaveBack: () => {
                gsap.to("#global-bg", { backgroundColor: "#050505", duration: 1 });
                gsap.to(targetMark, { x: 80, y: 45, scale: 0.45, r: 241, g: 199, b: 90, rotIntensity: 0.02, duration: 1.5, ease: "power3.out" });
                material.uniforms.uOpacity.value = 1;
                auraMaterial.uniforms.uOpacity.value = 0.15;
            }
        });

        ScrollTrigger.create({
            trigger: "#ecosystem-section",
            start: "top 60%", 
            onEnter: () => {
                gsap.to("#global-bg", { backgroundColor: "#f3efe5", duration: 1 });
                gsap.to(targetMark, { x: -16, y: 6, scale: 1.05, r: 232, g: 184, b: 47, rotIntensity: 0.018, duration: 1.6, ease: "power2.out" });
                gsap.to(material.uniforms.uOpacity, { value: 1.08, duration: 1.1, ease: "power2.out" });
                gsap.to(auraMaterial.uniforms.uOpacity, { value: 0.4, duration: 1.1, ease: "power2.out" });
                if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
                    gsap.fromTo(
                        ".perspective-chapter-head",
                        { autoAlpha: 0, y: 24, clipPath: "inset(0 0 100% 0)" },
                        { autoAlpha: 1, y: 0, clipPath: "inset(0 0 0% 0)", duration: 0.8, ease: "power4.out" }
                    );
                    gsap.fromTo(
                        ".contact-signal-panel",
                        { autoAlpha: 0, x: 80, clipPath: "inset(0 0 0 18%)" },
                        { autoAlpha: 1, x: 0, clipPath: "inset(0 0 0 0%)", duration: 0.9, ease: "power4.out", delay: 0.12 }
                    );
                    gsap.fromTo(
                        ".perspective-preview",
                        { autoAlpha: 0, y: 22 },
                        { autoAlpha: 1, y: 0, duration: 0.7, ease: "power3.out", delay: 0.28 }
                    );
                    gsap.fromTo(
                        ".aw-node",
                        { autoAlpha: 0, scale: 0.72 },
                        {
                            autoAlpha: 1,
                            scale: 1,
                            duration: 0.68,
                            stagger: 0.045,
                            ease: "back.out(1.4)",
                            delay: 0.18,
                            onComplete: () => gsap.set(".aw-node", { clearProps: "transform" })
                        }
                    );
                }
            },
            onLeaveBack: () => {
                gsap.to("#global-bg", { backgroundColor: "#030303", duration: 1 });
                gsap.to(targetMark, { x: 0, y: 40, scale: 0.7, r: 229, g: 189, b: 82, rotIntensity: 0.08, duration: 1.5, ease: "power2.out" });
                gsap.to(material.uniforms.uOpacity, { value: 1, duration: 0.8, ease: "power2.out" });
                gsap.to(auraMaterial.uniforms.uOpacity, { value: 0.15, duration: 0.8, ease: "power2.out" });
            }
        });

        // TEAM CREDENTIAL TABLE
        // The original project forensic data and overlay remain dormant below so
        // the deeper interaction can be restored without rebuilding it.
        const archivedProjectsData = window.__PORTFOLIO_DATA__ || [];
        const teamData = window.__TEAM_DATA__ || [];
        const deepDetailEnabled = false;
        const reduceTeamMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

        const projSection = document.getElementById('projects-section');
        const playSlot = document.getElementById('play-slot');
        const cardDetails = document.getElementById('card-details');
        const checkDetailBtn = document.getElementById('check-detail-btn');
        const detailOverlay = document.getElementById('detail-glass-overlay');
        const detailGrid = document.getElementById('detail-grid');
        const closeDetailBtn = document.getElementById('close-detail-btn');
        const detailGhostLayer = document.getElementById('detail-ghost-layer');
        const detailScanBeam = document.getElementById('detail-scan-beam');
        const detailPulseField = document.getElementById('detail-pulse-field');
        const checkDetailLabel = document.getElementById('check-detail-label');
        const detailPanels = Array.from(detailGrid.querySelectorAll('.detail-panel'));
        
        let activeCardIndex = -1;
        let cardElements = [];
        let isDetailMode = false;
        let detailTimeline = null;
        let ghostCardEl = null;
        let detailHandEl = null;
        let detailTrailTick = 0;
        let pulseNodes = [];

        function freezeTeamScroll() {
            const lockedScrollY = window.scrollY;
            lenis.stop();
            // Lenis 1.0 keeps its old target when stopped mid-ease. Synchronize
            // both animated and target scroll values before the card takes off,
            // otherwise restarting can chase that stale target and move the pin.
            lenis.scrollTo(lockedScrollY, {
                immediate: true,
                force: true
            });
            ScrollTrigger.update();
        }

        function getNeutralCardCenter(card) {
            // Measure the card without its fan rotation, hover scale, or live
            // GSAP transform. The absolute clone never paints, but gives a
            // stable local-space destination for every credential.
            const probe = card.cloneNode(false);
            probe.removeAttribute('aria-label');
            probe.setAttribute('aria-hidden', 'true');
            probe.style.cssText = '';
            probe.style.visibility = 'hidden';
            probe.style.pointerEvents = 'none';
            probe.style.transition = 'none';
            projSection.appendChild(probe);
            const rect = probe.getBoundingClientRect();
            probe.remove();
            return {
                x: rect.left + rect.width / 2,
                y: rect.top + rect.height / 2
            };
        }

        function escapeHtml(text) {
            return String(text || "")
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#39;");
        }

        function setCheckButtonState(enabled) {
            if (!checkDetailBtn) return;
            checkDetailBtn.disabled = !enabled;
            checkDetailBtn.style.pointerEvents = enabled ? "auto" : "none";
            if (checkDetailLabel) checkDetailLabel.textContent = enabled ? "CHECK" : "LOCK";
        }

        function spawnPulseField() {
            if (!detailPulseField) return;
            pulseNodes.forEach((node) => node.remove());
            pulseNodes = [];
            for (let i = 0; i < 16; i += 1) {
                const node = document.createElement('div');
                node.className = 'detail-pulse-node';
                const px = 34 + Math.random() * 62;
                const py = 8 + Math.random() * 82;
                node.style.left = `${px}%`;
                node.style.top = `${py}%`;
                detailPulseField.appendChild(node);
                pulseNodes.push(node);
                gsap.fromTo(node,
                    { autoAlpha: 0.15, scale: 0.65 },
                    { autoAlpha: 0.9, scale: 1.22, duration: 0.8 + Math.random() * 0.8, yoyo: true, repeat: -1, ease: "sine.inOut", delay: Math.random() * 0.5 }
                );
            }
        }

        function clearPulseField() {
            pulseNodes.forEach((node) => { gsap.killTweensOf(node); node.remove(); });
            pulseNodes = [];
        }

        function renderDetailContent(project) {
            const details = project.details || {};
            const title = document.getElementById('dg-title');
            const story = document.getElementById('dg-story');
            const stack = document.getElementById('dg-stack');
            const highlights = document.getElementById('dg-highlights');

            title.textContent = project.title;
            story.textContent = details.story || project.desc || "";

            const stackItems = Array.isArray(details.stack) && details.stack.length ? details.stack : ["Details Pending"];
            stack.innerHTML = stackItems.map((item) => `<span class="text-[10px] border border-white/40 bg-black px-2 py-1 uppercase tracking-[0.14em]">${escapeHtml(item)}</span>`).join("");

            const highlightItems = Array.isArray(details.highlights) && details.highlights.length ? details.highlights : [project.desc || "No highlights yet."];
            highlights.innerHTML = highlightItems.map((item) => `<li class="pl-3 relative before:content-['▸'] before:absolute before:left-0 before:text-white">${escapeHtml(item)}</li>`).join("");

            // Render accomplishment stacked folders
            const accomplishmentsContainer = document.getElementById('dg-accomplishments');
            const accomps = details.accomplishments || [{ year: "2026", title: "DATA MISSING", desc: "No records found." }];

            accomplishmentsContainer.innerHTML = '';
            let currentIndex = 0;

            function updateFolders() {
                const folders = Array.from(accomplishmentsContainer.children);
                folders.forEach((folder, i) => {
                    let diff = (i - currentIndex + accomps.length) % accomps.length;
                    const hint = folder.querySelector('.drag-hint');
                    
                    if (diff === 0) {
                        gsap.to(folder, { x: 0, y: 0, scale: 1, rotation: 0, zIndex: 30, opacity: 1, duration: 0.4, ease: "back.out(1.2)" });
                        folder.style.filter = 'brightness(1)';
                        folder.style.pointerEvents = 'auto';
                        if (hint) hint.style.opacity = '1';
                    } else if (diff === 1 || (accomps.length === 2 && diff === 1)) {
                        gsap.to(folder, { x: 12, y: 16, scale: 0.95, rotation: 0, zIndex: 20, opacity: 0.85, duration: 0.4, ease: "back.out(1.2)" });
                        folder.style.filter = 'brightness(0.75)';
                        folder.style.pointerEvents = 'none';
                        if (hint) hint.style.opacity = '0';
                    } else if (diff === 2) {
                        gsap.to(folder, { x: 24, y: 32, scale: 0.9, rotation: 0, zIndex: 10, opacity: 0.6, duration: 0.4, ease: "back.out(1.2)" });
                        folder.style.filter = 'brightness(0.5)';
                        folder.style.pointerEvents = 'none';
                        if (hint) hint.style.opacity = '0';
                    } else {
                        gsap.to(folder, { x: 36, y: 48, scale: 0.85, rotation: 0, zIndex: 0, opacity: 0, duration: 0.4, ease: "power2.out" });
                        folder.style.filter = 'brightness(0)';
                        folder.style.pointerEvents = 'none';
                        if (hint) hint.style.opacity = '0';
                    }
                });
            }

            accomps.forEach((acc, i) => {
                const folder = document.createElement('div');
                folder.className = 'folder-card text-white';
                folder.innerHTML = `
                    <div class="folder-top-bar">
                        <div class="folder-tab text-[10px] md:text-xs pl-3 pt-[2px] text-black font-bold font-space uppercase transition-colors" style="background: #ffcc00; border-color: #ffcc00; box-shadow: 0 0 10px rgba(255,204,0,0.4);">FILE_${i+1}/${accomps.length}</div>
                        <div class="folder-top-line" style="border-color: #ffcc00; opacity: 0.6;"></div>
                    </div>
                    <div class="flex justify-between items-center mb-3 mt-1">
                        <div class="text-xs md:text-sm text-[#ffcc00] font-space uppercase tracking-widest bg-black/60 px-2 py-1 border border-[#ffcc00]/40 backdrop-blur-sm shadow-[0_0_12px_rgba(255,204,0,0.15)]">
                            [ ${escapeHtml(acc.year)} ]
                        </div>
                        <div class="flex gap-1.5 opacity-80">
                            <div class="w-1.5 h-1.5 bg-white/30"></div>
                            <div class="w-1.5 h-1.5 bg-white/30"></div>
                            <div class="w-1.5 h-1.5 bg-[#ffcc00] animate-pulse"></div>
                        </div>
                    </div>
                    <div class="text-lg md:text-2xl font-black mb-4 leading-tight text-white tracking-wide border-l-[3px] border-[#ffcc00] pl-3 drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
                        ${escapeHtml(acc.title)}
                    </div>
                    <div class="folder-desc text-sm md:text-base text-gray-200 flex-1 overflow-y-auto leading-relaxed pr-3 font-space bg-gradient-to-b from-black/40 to-transparent p-4 rounded-sm border border-white/10 relative pb-12">
                        <div class="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAiIGhlaWdodD0iMTAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMSIgY3k9IjEiIHI9IjEiIGZpbGw9InJnYmEoMjU1LDI1NSwyNTUsMC4wNSkiLz48L3N2Zz4=')] pointer-events-none opacity-60"></div>
                        <span class="relative z-10 block">${escapeHtml(acc.desc)}</span>
                    </div>
                    <div class="drag-hint absolute bottom-4 right-4 flex items-center gap-2 text-black font-space text-[10px] md:text-xs font-bold uppercase tracking-widest bg-[#ffcc00] px-3 py-1.5 shadow-[3px_3px_0_rgba(255,255,255,1)] transition-opacity duration-300">
                        <span class="animate-swipe text-sm md:text-base">🤚</span>
                        <span>DRAG TO FLIP</span>
                    </div>
                `;
                
                let isDragging = false;
                let startX = 0, startY = 0;
                let currentX = 0, currentY = 0;

                folder.addEventListener('pointerdown', (e) => {
                    let diff = (i - currentIndex + accomps.length) % accomps.length;
                    if(diff !== 0) return; // Only the top folder is draggable
                    
                    // Smart handling: prioritize scroll when user touches long text area
                    const descEl = e.target.closest('.folder-desc');
                    if (descEl && descEl.scrollHeight > descEl.clientHeight) {
                        return; 
                    }
                    
                    isDragging = true;
                    startX = e.clientX - currentX;
                    startY = e.clientY - currentY;
                    folder.setPointerCapture(e.pointerId);
                    gsap.killTweensOf(folder); // Stop existing tweens and follow pointer
                });

                folder.addEventListener('pointermove', (e) => {
                    if(!isDragging) return;
                    currentX = e.clientX - startX;
                    currentY = e.clientY - startY;
                    
                    // Add subtle physical rotation while dragging
                    let rot = currentX * 0.05;
                    gsap.set(folder, { x: currentX, y: currentY, rotation: rot });
                });

                const endDrag = (e) => {
                    if(!isDragging) return;
                    isDragging = false;
                    folder.releasePointerCapture(e.pointerId);
                    
                    let isClick = Math.abs(currentX) < 5 && Math.abs(currentY) < 5;
                    
                    // Trigger throw-and-flip on threshold drag or click
                    if(Math.abs(currentX) > 80 || Math.abs(currentY) > 80 || isClick) {
                        let dirX = currentX > 0 ? 1 : (currentX < 0 ? -1 : 1);
                        let dirY = currentY > 0 ? 1 : (currentY < 0 ? -1 : -1);
                        if (isClick) { dirX = 1; dirY = -1; currentX = 50; currentY = -50; } 
                        
                        gsap.to(folder, {
                            x: currentX + dirX * 150,
                            y: currentY + dirY * 150,
                            opacity: 0,
                            rotation: dirX * 15,
                            duration: 0.3,
                            onComplete: () => {
                                currentX = 0; currentY = 0;
                                // Move card instantly to bottom of stack before reveal
                                gsap.set(folder, { x: 36, y: 48, scale: 0.85, opacity: 0, rotation: 0 });
                                currentIndex = (currentIndex + 1) % accomps.length;
                                updateFolders();
                            }
                        });
                    } else {
                        // Snap back elastically if threshold is not reached
                        currentX = 0; currentY = 0;
                        gsap.to(folder, { x: 0, y: 0, rotation: 0, duration: 0.4, ease: "back.out(1.5)" });
                    }
                };

                folder.addEventListener('pointerup', endDrag);
                folder.addEventListener('pointercancel', endDrag);

                accomplishmentsContainer.appendChild(folder);
            });

            updateFolders();
        }

        function createGhostCard(sourceCard) {
            if (!sourceCard) return null;
            const rect = sourceCard.getBoundingClientRect();
            const ghost = sourceCard.cloneNode(true);
            ghost.classList.add('detail-ghost-card');
            ghost.style.left = `${rect.left}px`; ghost.style.top = `${rect.top}px`;
            ghost.style.width = `${rect.width}px`; ghost.style.height = `${rect.height}px`;
            ghost.style.transform = 'none';
            detailGhostLayer.appendChild(ghost);
            return ghost;
        }

        function createHandSweep(sourceRect) {
            if (detailHandEl) detailHandEl.remove();
            const hand = document.createElement('div');
            hand.className = 'detail-hand-sweep';
            hand.style.width = `${Math.max(130, sourceRect.width * 0.9)}px`;
            hand.style.height = `${Math.max(54, sourceRect.height * 0.22)}px`;
            hand.style.left = `${sourceRect.left + sourceRect.width * 0.55}px`;
            hand.style.top = `${sourceRect.top + sourceRect.height * 0.58}px`;
            detailGhostLayer.appendChild(hand);
            detailHandEl = hand;
            return hand;
        }

        function updateGhostHighlight(event) {
            if (!isDetailMode || !ghostCardEl) return;
            const rect = ghostCardEl.getBoundingClientRect();
            const px = Math.min(Math.max(((event.clientX - rect.left) / Math.max(rect.width, 1)) * 100, 0), 100);
            const py = Math.min(Math.max(((event.clientY - rect.top) / Math.max(rect.height, 1)) * 100, 0), 100);
            ghostCardEl.style.setProperty('--mx', `${px}%`); ghostCardEl.style.setProperty('--my', `${py}%`);
        }

        function emitGhostTrail() {
            if (!ghostCardEl) return;
            detailTrailTick += 1;
            const rect = ghostCardEl.getBoundingClientRect();
            const trail = ghostCardEl.cloneNode(true);
            trail.classList.remove('detail-ghost-card'); trail.classList.add('detail-trail-card');
            trail.style.left = `${rect.left}px`; trail.style.top = `${rect.top}px`;
            trail.style.width = `${rect.width}px`; trail.style.height = `${rect.height}px`;
            trail.style.transform = 'none'; trail.style.filter = 'blur(0.3px)';
            detailGhostLayer.appendChild(trail);
            const driftY = (detailTrailTick % 2 === 0) ? -6 : 5;
            gsap.to(trail, { x: -26 - (detailTrailTick % 3) * 6, y: driftY, scale: 0.96, opacity: 0, duration: 0.32, ease: "power2.out", onComplete: () => trail.remove() });
        }

        function openDetailMode() {
            if (isDetailMode || activeCardIndex === -1) return;
            const activeCard = cardElements[activeCardIndex];
            const activeProject = archivedProjectsData[activeCardIndex];
            if (!activeCard || !activeProject) return;

            renderDetailContent(activeProject);
            if (detailTimeline) detailTimeline.kill();
            if (ghostCardEl) ghostCardEl.remove();
            ghostCardEl = createGhostCard(activeCard);
            if (!ghostCardEl) return;

            const sourceRect = activeCard.getBoundingClientRect();
            const centerX = window.innerWidth / 2 - sourceRect.left - sourceRect.width / 2;
            const centerY = window.innerHeight * 0.42 - sourceRect.top - sourceRect.height / 2;
            const leftX = window.innerWidth * (window.innerWidth < 768 ? 0.18 : 0.22) - sourceRect.left - sourceRect.width / 2;
            const leftY = window.innerHeight * 0.52 - sourceRect.top - sourceRect.height / 2;
            const handEl = createHandSweep(sourceRect);

            detailTimeline = gsap.timeline({
                onStart: () => {
                    isDetailMode = true;
                    gsap.set(detailOverlay, { pointerEvents: "auto" });
                    gsap.set(activeCard, { autoAlpha: 0 });
                    setCheckButtonState(false);
                    if (checkDetailLabel) checkDetailLabel.textContent = "OPEN";
                    triggerMarkPulse();
                    gsap.to(targetMark, { r: 255, g: 211, b: 94, duration: 0.3 });
                    window.addEventListener('mousemove', updateGhostHighlight);
                    spawnPulseField();
                }
            });

            detailTimeline
                .to(cardDetails, { autoAlpha: 0, x: -16, duration: 0.2, ease: "power2.inOut" }, 0)
                .to(ghostCardEl, { x: centerX, y: centerY - 20, rotationZ: -4, scale: 1.12, duration: 0.36, ease: "power2.out" }, 0)
                .fromTo(handEl, { autoAlpha: 0, rotationZ: -18, scaleX: 0.75 }, { autoAlpha: 0.75, rotationZ: -8, scaleX: 1.05, duration: 0.22, ease: "power2.out" }, 0.08)
                .to(ghostCardEl, { x: leftX, y: leftY, rotationZ: -8, scale: 1.08, duration: 0.42, ease: "power3.inOut" }, 0.36)
                .add(() => emitGhostTrail(), 0.4).add(() => emitGhostTrail(), 0.5)
                .to(handEl, { x: -70, y: -12, autoAlpha: 0, duration: 0.3, ease: "power1.inOut" }, 0.33)
                .to(detailOverlay, { autoAlpha: 1, duration: 0.42, ease: "power2.out" }, 0.2)
                .fromTo(detailScanBeam, { xPercent: 0, autoAlpha: 0 }, { xPercent: 520, autoAlpha: 0.95, duration: 0.62, ease: "power1.out" }, 0.35)
                .to(detailScanBeam, { autoAlpha: 0.08, duration: 0.25, ease: "power1.inOut" }, 0.9)
                .to(detailGrid, { autoAlpha: 1, x: 0, duration: 0.45, ease: "power3.out", startAt: { x: 30 } }, 0.45)
                .fromTo(detailPanels, { autoAlpha: 0.2, y: 18, filter: "blur(4px)" }, { autoAlpha: 1, y: 0, filter: "blur(0px)", duration: 0.42, ease: "power2.out", stagger: 0.08 }, 0.57)
                .to("#game-board", { filter: "blur(1.2px)", duration: 0.35, ease: "power1.out" }, 0.22);
        }

        function closeDetailMode(done) {
            if (!isDetailMode) {
                if (typeof done === "function") done();
                return;
            }
            const activeCard = cardElements[activeCardIndex];
            if (!activeCard) {
                isDetailMode = false;
                if (ghostCardEl) ghostCardEl.remove(); ghostCardEl = null;
                if (detailHandEl) detailHandEl.remove(); detailHandEl = null;
                window.removeEventListener('mousemove', updateGhostHighlight); clearPulseField();
                gsap.set(detailOverlay, { autoAlpha: 0, pointerEvents: "none" }); gsap.set("#game-board", { clearProps: "filter" });
                setCheckButtonState(activeCardIndex !== -1);
                if (typeof done === "function") done(); return;
            }
            if (detailTimeline) detailTimeline.kill();

            const ghostLeft = ghostCardEl ? parseFloat(ghostCardEl.style.left || "0") : 0;
            const ghostTop = ghostCardEl ? parseFloat(ghostCardEl.style.top || "0") : 0;
            const targetRect = activeCard.getBoundingClientRect();
            const toX = targetRect.left - ghostLeft; const toY = targetRect.top - ghostTop;

            detailTimeline = gsap.timeline({
                onComplete: () => {
                    if (ghostCardEl) ghostCardEl.remove(); ghostCardEl = null;
                    if (detailHandEl) detailHandEl.remove(); detailHandEl = null;
                    window.removeEventListener('mousemove', updateGhostHighlight); clearPulseField();
                    gsap.set(detailOverlay, { autoAlpha: 0, pointerEvents: "none" });
                    gsap.set(detailGrid, { clearProps: "x,opacity" }); gsap.set(detailPanels, { clearProps: "filter,opacity,y" });
                    gsap.set(detailScanBeam, { clearProps: "opacity,transform" }); gsap.set("#game-board", { clearProps: "filter" });
                    gsap.set(activeCard, { autoAlpha: 1 });
                    isDetailMode = false;
                    if (activeCardIndex !== -1) gsap.to(cardDetails, { autoAlpha: 1, x: 0, duration: 0.2, startAt: { x: -16 } });
                    setCheckButtonState(activeCardIndex !== -1);
                    if (typeof done === "function") done();
                }
            });

            detailTimeline
                .to(detailGrid, { autoAlpha: 0, x: 20, duration: 0.24, ease: "power2.inOut" }, 0)
                .to(detailOverlay, { autoAlpha: 0, duration: 0.3, ease: "power2.inOut" }, 0.06)
                .to("#game-board", { filter: "blur(0px)", duration: 0.26, ease: "power1.inOut" }, 0)
                .to(ghostCardEl, { x: toX, y: toY, rotationZ: 0, scale: 1, duration: 0.34, ease: "power3.inOut" }, 0.03);
        }

        function returnCardToHand() {
            if(activeCardIndex === -1) return;
            let i = activeCardIndex; let card = cardElements[i];
            
            gsap.to(cardDetails, { autoAlpha: 0, x: -20, duration: 0.2 });
            playSlot.classList.remove('active'); setCheckButtonState(false);

            let startX = parseFloat(card.dataset.startX); let startY = parseFloat(card.dataset.startY); let startRot = parseFloat(card.dataset.startRot);
            gsap.to(card, { x: startX, y: startY, rotationZ: startRot, scale: 1, duration: 0.6, ease: "back.out(1.5)" });
            card.style.removeProperty("box-shadow");
            card.style.removeProperty("border-color");
            card.style.cursor = "pointer";

            cardElements.forEach((c, idx) => {
                if(idx !== i) {
                    c.style.removeProperty("box-shadow");
                    c.style.removeProperty("border-color");
                    c.style.cursor = "pointer";
                    gsap.to(c, { y: c.dataset.startY, opacity: 1, pointerEvents: 'auto', duration: 0.5, delay: 0.1, ease: "back.out(1.2)" });
                }
            });

            activeCardIndex = -1;
        }

        function createSlamParticles(x, y) {
            for(let i=0; i<40; i++) {
                let p = document.createElement('div');
                p.className = 'absolute w-1 h-1 md:w-2 md:h-2 bg-white z-50 pointer-events-none rounded-none shadow-[0_0_5px_#fff]';
                p.style.left = x + 'px'; p.style.top = y + 'px';
                projSection.appendChild(p);
                
                let angle = Math.random() * Math.PI * 2; let speed = 80 + Math.random() * 250;
                gsap.to(p, {
                    x: Math.cos(angle) * speed, y: Math.sin(angle) * speed, opacity: 0, rotation: Math.random() * 360, scale: 0.2 + Math.random(),
                    duration: 0.6 + Math.random() * 0.4, ease: "power3.out", onComplete: () => p.remove()
                });
            }
        }

        teamData.forEach((data, i) => {
            let card = document.createElement('button');
            card.type = 'button';
            card.setAttribute('aria-label', `Open profile for ${data.name}`);
            card.className = 'team-name-card absolute left-1/2 bottom-[-1vh] md:bottom-[2vh] w-[172px] h-[246px] md:w-[210px] md:h-[292px] z-30 cursor-pointer transform-gpu text-left';
            card.innerHTML = `
                <div class="team-card-photo-shell">
                    <img src="${escapeHtml(data.photo)}" alt="" loading="lazy" decoding="async" />
                </div>
                <div class="team-card-identity">
                    <div class="team-card-record">
                        <span>${escapeHtml(data.initials)} / Creekstone</span>
                    </div>
                    <div>
                        <h4>${escapeHtml(data.name)}</h4>
                        <p>${escapeHtml(data.role)}</p>
                    </div>
                </div>
            `;
            projSection.appendChild(card); cardElements.push(card);

            // Use fixed cardWidth instead of offsetWidth to avoid zero-width reads before DOM settles
            let cardWidth = window.innerWidth < 768 ? 172 : 210;
            let offset = i - (teamData.length - 1) / 2; 
            let startXOffset = window.innerWidth < 768 ? 72 : 118;
            let startX = - (cardWidth / 2) + (offset * startXOffset); 
            // Use a smooth parabolic arc
            let startY = Math.pow(offset, 2) * 22; 
            let startRot = offset * 9;

            gsap.set(card, { x: startX, y: startY, rotationZ: startRot, zIndex: 30 + i });
            card.dataset.startX = startX; 
            card.dataset.startY = startY; 
            card.dataset.startRot = startRot;

            card.addEventListener('mouseenter', () => {
                if(activeCardIndex !== -1) return;
                gsap.to(card, { y: startY - 40, rotationZ: startRot * 0.4, scale: 1.05, duration: reduceTeamMotion ? 0 : 0.3, ease: "back.out(2)" });
                card.style.boxShadow = "0 24px 48px rgba(0,0,0,0.56), 0 0 0 1px rgba(229,189,82,0.48)"; 
                card.style.borderColor = "#e5bd52";
            });
            
            card.addEventListener('mouseleave', () => {
                if(activeCardIndex !== -1) return;
                gsap.to(card, { y: startY, rotationZ: startRot, scale: 1, duration: reduceTeamMotion ? 0 : 0.3, ease: "power2.out" });
                card.style.boxShadow = "7px 9px 30px rgba(0,0,0,0.44)"; 
                card.style.borderColor = "rgba(229,189,82,0.64)";
            });

            card.addEventListener('click', () => {
                if(activeCardIndex === i || activeCardIndex !== -1) return; 
                activeCardIndex = i;
                freezeTeamScroll();
                gsap.killTweensOf(card);

                cardElements.forEach((c, idx) => { if(idx !== i) gsap.to(c, { y: 200, opacity: 0, pointerEvents: 'none', duration: 0.4 }); });

                const slotRect = playSlot.getBoundingClientRect();
                let slotCenterX = slotRect.left + slotRect.width/2; let slotCenterY = slotRect.top + slotRect.height/2;
                const neutralCardCenter = getNeutralCardCenter(card);
                let currentX = gsap.getProperty(card, "x"); let currentY = gsap.getProperty(card, "y");
                let finalX = slotCenterX - neutralCardCenter.x; let finalY = slotCenterY - neutralCardCenter.y;
                let moveX = finalX - currentX; let moveY = finalY - currentY;

                let tl = gsap.timeline({
                    onComplete: () => {
                        if (!reduceTeamMotion) {
                            createSlamParticles(slotCenterX, slotCenterY);
                            // Never shake either the ScrollTrigger pin target or
                            // the transformed board. The empty slot has no
                            // positioning transform and safely carries impact.
                            gsap.fromTo(
                                playSlot,
                                { x: 0, y: 0 },
                                {
                                    x: 10,
                                    y: 8,
                                    duration: 0.04,
                                    yoyo: true,
                                    repeat: 5,
                                    onComplete: () => gsap.set(playSlot, { clearProps: "x,y" })
                                }
                            );
                        }
                        playSlot.classList.add('active');
                        
                        document.getElementById('detail-tag').innerText = data.role;
                        document.getElementById('detail-title').innerText = data.name;
                        document.getElementById('detail-focus').innerText = data.focus;
                        document.getElementById('detail-desc').innerText = data.bio[0];
                        document.getElementById('detail-desc-secondary').innerText = data.bio[1];
                        
                        const titleEl = document.getElementById('detail-title');
                        titleEl.classList.add('glitch-reveal'); setTimeout(() => titleEl.classList.remove('glitch-reveal'), 500);

                        gsap.to(cardDetails, { autoAlpha: 1, x: 0, duration: 0.4, ease: "power3.out", startAt: { x: -40 } });
                        setCheckButtonState(false); lenis.start();

                        triggerMarkPulse(); 
                        gsap.to(targetMark, { scale: 0.9, r: 229, g: 189, b: 82, duration: 0.1, yoyo: true, repeat: 1, ease: "power4.inOut" });
                    }
                });

                tl.to(card, {
                    x: currentX + (moveX * 0.5), y: currentY + (moveY * 0.5) - 150, 
                    rotationZ: 0, rotationY: 25, rotationX: 10, scale: 1.4, duration: reduceTeamMotion ? 0 : 0.35, ease: "power2.out"
                }).to(card, {
                    x: finalX, y: finalY, rotationY: 0, rotationX: 0, scale: 1, duration: reduceTeamMotion ? 0 : 0.15, ease: "power4.in"
                });
                
                card.style.boxShadow = "none"; card.style.borderColor = "#fff"; card.style.cursor = "default";
            });
        });

        setCheckButtonState(false);
        if (deepDetailEnabled) {
            checkDetailBtn.addEventListener('click', () => openDetailMode());
        }
        closeDetailBtn.addEventListener('click', () => closeDetailMode(() => returnCardToHand()));
        detailOverlay.addEventListener('click', (e) => {
            if (e.target === detailOverlay || e.target.classList.contains('detail-glass-backdrop')) closeDetailMode(() => returnCardToHand());
        });
        document.getElementById('return-btn').addEventListener('click', () => {
            if (isDetailMode) { closeDetailMode(() => returnCardToHand()); return; }
            returnCardToHand();
        });

        // Bind resize recalculation logic
        window.addEventListener('resize', () => {
            if (isDetailMode) closeDetailMode();
            if (activeCardIndex !== -1) return; 
            cardElements.forEach((card, i) => {
                let cardWidth = window.innerWidth < 768 ? 172 : 210;
                let offset = i - (teamData.length - 1) / 2; 
                let startXOffset = window.innerWidth < 768 ? 72 : 118;
                let startX = - (cardWidth / 2) + (offset * startXOffset);
                let startY = Math.pow(offset, 2) * 22;
                let startRot = offset * 9;
                card.dataset.startX = startX; 
                card.dataset.startY = startY; 
                card.dataset.startRot = startRot;
                gsap.set(card, { x: startX, y: startY, rotationZ: startRot });
            });
        });

        // PERSPECTIVES SIGNAL FIELD
        // Reuses the former ecosystem node physics for Creekstone's real
        // writing, portfolio updates, and podcast episodes.
        function initPerspectiveField() {
            const wrapper = document.getElementById('aw-wrapper');
            const container = document.getElementById('aw-container');
            if(!wrapper || !container) return;
            const perspectiveData = window.__PERSPECTIVES_DATA__ || [];
            if (!perspectiveData.length) return;

            const previewSource = document.getElementById('perspective-preview-source');
            const previewTitle = document.getElementById('perspective-preview-title');
            const reducePerspectiveMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            const outerPerspectiveData = perspectiveData.slice(6);
            const outerRealSlots = [0, 2, 5, 7, 10];
            const placeholderCopy = [
                {
                    source: "Open Seat",
                    category: "Next Collaborator",
                    title: "Reserved for the next collaborator."
                },
                {
                    source: "Signal Pending",
                    category: "Awaiting a New Voice",
                    title: "Waiting for the next voice from the frontier."
                },
                {
                    source: "Future Partner",
                    category: "Room to Build",
                    title: "Space for the next partner building what comes next."
                }
            ];
            let placeholderIndex = 0;
            const outerRingData = Array.from({ length: 12 }, (_, slotIndex) => {
                const realIndex = outerRealSlots.indexOf(slotIndex);
                if (realIndex !== -1) return outerPerspectiveData[realIndex];
                const placeholder = placeholderCopy[placeholderIndex % placeholderCopy.length];
                placeholderIndex += 1;
                return { ...placeholder, placeholder: true };
            });
            const fieldData = [
                {
                    source: "Creekstone",
                    title: "Portfolio updates, essays, and conversations from the frontier.",
                    category: "Perspectives",
                    core: true
                },
                ...perspectiveData.slice(0, 6),
                ...outerRingData
            ];
            const bubbles = [];

            function setPerspectivePreview(data) {
                if (!previewSource || !previewTitle) return;
                previewSource.textContent = `${data.source} / ${data.category}`;
                previewTitle.textContent = data.title;
                gsap.fromTo(
                    previewTitle,
                    { autoAlpha: reducePerspectiveMotion ? 1 : 0.35, y: reducePerspectiveMotion ? 0 : 7 },
                    { autoAlpha: 1, y: 0, duration: reducePerspectiveMotion ? 0 : 0.3, ease: "power2.out" }
                );
            }

            fieldData.forEach((data, index) => {
                const bubble = document.createElement(data.href ? 'a' : 'div');
                bubble.className = `aw-bubble${data.placeholder ? ' aw-bubble--empty' : ''}`;
                const toneClass = data.core || data.placeholder
                    ? ""
                    : ` aw-node-tone-${data.category.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
                if (data.href) {
                    bubble.href = data.href;
                    bubble.target = '_blank';
                    bubble.rel = 'noreferrer';
                    bubble.setAttribute('aria-label', `${data.source}: ${data.title}`);
                    bubble.title = data.title;
                } else if (data.placeholder) {
                    bubble.setAttribute('role', 'note');
                    bubble.setAttribute('aria-label', `${data.source}: ${data.category}`);
                } else {
                    bubble.setAttribute('aria-hidden', 'true');
                }
                bubble.innerHTML = `
                    <span class="aw-node${data.core ? ' aw-node-core' : ''}${data.placeholder ? ' aw-node-empty' : ''}${toneClass}">
                        <strong class="aw-title">${escapeHtml(data.source)}</strong>
                        <small>${escapeHtml(data.category)}</small>
                        <span class="aw-square-particles" aria-hidden="true">
                            <i></i><i></i><i></i><i></i>
                            <i></i><i></i><i></i><i></i>
                        </span>
                    </span>
                `;
                bubble.dataset.fieldIndex = index;
                bubble.dataset.floatPhase = String(index * 1.731 + (index % 3) * 0.47);
                bubble.dataset.floatAmplitude = String(
                    data.core ? 1.2 : index <= 6 ? 2.7 : data.placeholder ? 1.8 : 4.1
                );
                bubble.dataset.baseRotation = String(
                    data.core ? 0 : ((((index * 11) % 9) - 4) * (data.placeholder ? 0.42 : 0.3))
                );
                if (!data.core) {
                    bubble.addEventListener('mouseenter', () => setPerspectivePreview(data));
                    bubble.addEventListener('focus', () => setPerspectivePreview(data));
                }
                wrapper.appendChild(bubble);
                bubbles.push(bubble);
            });

            let baseD = 140;
            let gridTargetX = 0;
            let gridTargetY = 0;
            let gridCurrentX = 0;
            let gridCurrentY = 0;
            let fieldActive = true;
            let renderFrame = null;
            let hasFinePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
            let pointerLocalX = Number.POSITIVE_INFINITY;
            let pointerLocalY = Number.POSITIVE_INFINITY;
            let activeHoverIndex = -1;

            function layoutPerspectiveNodes() {
                const compact = window.innerWidth < 768;
                const rect = container.getBoundingClientRect();
                baseD = compact
                    ? Math.max(54, Math.min(rect.width, rect.height) * 0.19)
                    : Math.min(205, rect.width * 0.25, rect.height * 0.315);
                const innerSizeFactors = [1, 0.95, 1.03, 0.92, 0.99, 0.96];
                const outerSizeFactors = [1, 0.88, 1.04, 0.91, 0.96, 0.85, 1.02, 0.9, 0.98, 0.87, 1.05, 0.93];

                bubbles.forEach((bubble, index) => {
                    let x = 0;
                    let y = 0;
                    const bubbleSize = compact
                        ? index === 0
                            ? Math.min(72, rect.width * 0.19)
                            : index <= 6
                                ? Math.min(60, rect.width * 0.155) * innerSizeFactors[index - 1]
                                : Math.min(50, rect.width * 0.13) * outerSizeFactors[index - 7]
                        : index === 0
                            ? Math.min(188, rect.width * 0.23)
                            : index <= 6
                                ? Math.min(160, rect.width * 0.195) * innerSizeFactors[index - 1]
                                : Math.min(132, rect.width * 0.161) * outerSizeFactors[index - 7];
                    if (index > 0 && index <= 6) {
                        const angle = compact
                            ? -Math.PI / 2 + ((index - 1) / 6) * Math.PI * 2
                            : ((index - 1) / 6) * Math.PI * 2;
                        x = Math.cos(angle) * baseD;
                        y = Math.sin(angle) * baseD;
                    } else if (index > 6) {
                        if (compact) {
                            const angle = -Math.PI / 2 + ((index - 7) / 12) * Math.PI * 2;
                            x = Math.cos(angle) * baseD * 1.7;
                            y = Math.sin(angle) * baseD * 1.7;
                        } else {
                            const outerIndex = index - 7;
                            const side = Math.floor(outerIndex / 2);
                            const startAngle = side * Math.PI / 3;
                            const endAngle = ((side + 1) % 6) * Math.PI / 3;
                            const start = {
                                x: Math.cos(startAngle) * baseD * 2,
                                y: Math.sin(startAngle) * baseD * 2
                            };
                            if (outerIndex % 2 === 0) {
                                x = start.x;
                                y = start.y;
                            } else {
                                const end = {
                                    x: Math.cos(endAngle) * baseD * 2,
                                    y: Math.sin(endAngle) * baseD * 2
                                };
                                x = (start.x + end.x) / 2;
                                y = (start.y + end.y) / 2;
                            }
                        }
                    }
                    if (index > 0) {
                        const jitterScale = compact ? 0.65 : 2.4;
                        x += (((index * 17) % 7) - 3) * jitterScale;
                        y += (((index * 29) % 9) - 4) * jitterScale;
                    }
                    bubble.dataset.x = x;
                    bubble.dataset.y = y;
                    bubble.style.width = `${bubbleSize}px`;
                    bubble.style.height = `${bubbleSize}px`;
                    bubble.style.marginLeft = `${-bubbleSize / 2}px`;
                    bubble.style.marginTop = `${-bubbleSize / 2}px`;
                });
            }

            if (!reducePerspectiveMotion) {
                container.addEventListener('mousemove', (e) => {
                    const rect = container.getBoundingClientRect();
                    const compact = window.innerWidth < 768;
                    gridTargetX = compact ? 0 : -(e.clientX - rect.left - rect.width / 2) * 1.5;
                    gridTargetY = compact ? 0 : -(e.clientY - rect.top - rect.height / 2) * 1.5;
                    pointerLocalX = e.clientX - rect.left - wrapper.offsetLeft;
                    pointerLocalY = e.clientY - rect.top - wrapper.offsetTop;
                });
                container.addEventListener('mouseleave', () => {
                    gridTargetX = 0;
                    gridTargetY = 0;
                    pointerLocalX = Number.POSITIVE_INFINITY;
                    pointerLocalY = Number.POSITIVE_INFINITY;
                    activeHoverIndex = -1;
                    bubbles.forEach((bubble) => bubble.classList.remove('is-hovered'));
                });
            }

            function renderGrid() {
                renderFrame = null;
                gridCurrentX += (gridTargetX - gridCurrentX) * 0.08; gridCurrentY += (gridTargetY - gridCurrentY) * 0.08;
                const compact = window.innerWidth < 768;
                const radiusEffect = compact ? 320 : 580;
                const floatTime = performance.now() * 0.00045;
                let hoverCandidate = -1;
                let hoverCandidateScore = Number.NEGATIVE_INFINITY;
                bubbles.forEach((bubble, index) => {
                    const bx = parseFloat(bubble.dataset.x); const by = parseFloat(bubble.dataset.y);
                    const screenX = bx + gridCurrentX; const screenY = by + gridCurrentY;
                    const dist = Math.sqrt(screenX * screenX + screenY * screenY);
                    let scale = 1;
                    let opacity = 1;
                    if (compact) {
                        const normalized = Math.min(Math.sqrt(bx * bx + by * by) / Math.max(baseD * 1.7, 1), 1);
                        scale = bubble.dataset.fieldIndex === '0' ? 1 : 0.96 - normalized * 0.18;
                        opacity = 1 - Math.pow(normalized, 1.6) * 0.28;
                    } else if (dist < radiusEffect) {
                        scale = Math.max(0.15, Math.cos((dist / radiusEffect) * (Math.PI / 2.2)));
                        const fadeStart = radiusEffect * 0.56;
                        const fadeProgress = Math.max(
                            0,
                            Math.min(1, (dist - fadeStart) / (radiusEffect - fadeStart))
                        );
                        const smoothFade = fadeProgress * fadeProgress * (3 - 2 * fadeProgress);
                        opacity = 1 - smoothFade;
                    } else {
                        scale = 0.15;
                        opacity = 0;
                    }
                    if (fieldData[index].placeholder) {
                        opacity *= 0.68;
                    }
                    const pull = compact
                        ? 1 - Math.min(Math.sqrt(bx * bx + by * by) / Math.max(baseD * 1.7, 1), 1) * 0.08
                        : Math.max(0.4, Math.pow(scale, 0.7));
                    const finalX = screenX * pull; const finalY = screenY * pull;
                    const floatPhase = parseFloat(bubble.dataset.floatPhase);
                    const floatAmplitude = parseFloat(bubble.dataset.floatAmplitude) * (compact ? 0.58 : 1);
                    const baseRotation = parseFloat(bubble.dataset.baseRotation);
                    const floatX = reducePerspectiveMotion ? 0 : Math.sin(floatTime + floatPhase) * floatAmplitude;
                    const floatY = reducePerspectiveMotion
                        ? 0
                        : Math.cos(floatTime * 0.83 + floatPhase * 1.37) * floatAmplitude * 0.72;
                    const floatRotation = reducePerspectiveMotion
                        ? baseRotation
                        : baseRotation + Math.sin(floatTime * 0.61 + floatPhase) * (index === 0 ? 0.22 : 0.58);
                    const displayX = finalX + floatX;
                    const displayY = finalY + floatY;
                    bubble.style.transform = `translate(${displayX}px, ${displayY}px) scale(${scale}) rotate(${floatRotation}deg)`;
                    bubble.style.opacity = String(opacity);
                    bubble.style.zIndex = bubble.dataset.fieldIndex === '0' ? '100' : String(Math.round(scale * 100));
                    if (hasFinePointer && opacity > 0 && !fieldData[index].placeholder) {
                        const nodeHalf = Math.max(22, parseFloat(bubble.style.width) * scale * 0.5);
                        const pointerDeltaX = Math.abs(pointerLocalX - displayX);
                        const pointerDeltaY = Math.abs(pointerLocalY - displayY);
                        if (pointerDeltaX <= nodeHalf && pointerDeltaY <= nodeHalf) {
                            const edgeDistance = Math.max(pointerDeltaX, pointerDeltaY);
                            const score = scale - (edgeDistance / nodeHalf) * 0.1;
                            if (score > hoverCandidateScore) {
                                hoverCandidate = index;
                                hoverCandidateScore = score;
                            }
                        }
                    }
                });
                if (hoverCandidate !== activeHoverIndex) {
                    activeHoverIndex = hoverCandidate;
                    bubbles.forEach((bubble, index) => {
                        bubble.classList.toggle('is-hovered', index === activeHoverIndex);
                    });
                    if (activeHoverIndex > 0) {
                        setPerspectivePreview(fieldData[activeHoverIndex]);
                    }
                }
                if (!reducePerspectiveMotion && fieldActive) {
                    renderFrame = requestAnimationFrame(renderGrid);
                }
            }

            layoutPerspectiveNodes();
            renderGrid();
            window.addEventListener('resize', () => {
                hasFinePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
                layoutPerspectiveNodes();
                if (reducePerspectiveMotion) renderGrid();
            });
            if (!reducePerspectiveMotion && "IntersectionObserver" in window) {
                const fieldObserver = new IntersectionObserver(([entry]) => {
                    fieldActive = entry.isIntersecting;
                    if (fieldActive && renderFrame === null) {
                        renderFrame = requestAnimationFrame(renderGrid);
                    }
                }, { threshold: 0.01 });
                fieldObserver.observe(container);
            }
        }

        function initContactSignal() {
            const form = document.getElementById('contact-founder-form');
            const input = document.getElementById('contact-founder-message');
            const status = document.getElementById('contact-founder-status');
            if (!form || !input || !status) return;

            form.addEventListener('submit', (event) => {
                event.preventDefault();
                const message = input.value.trim();
                if (!message) {
                    status.textContent = "Add a short founder note before sending.";
                    input.focus();
                    return;
                }
                status.textContent = "Opening your email client.";
                window.location.href = `mailto:claw@creekstonevc.com?subject=Founder%20Inquiry&body=${encodeURIComponent(message)}`;
            });
        }

        if (document.readyState === "complete") {
            initPerspectiveField();
            initContactSignal();
        } else {
            window.addEventListener('load', () => {
                initPerspectiveField();
                initContactSignal();
            }, { once: true });
        }

        // GLOBAL CHAPTER TELEMETRY
        const chapterProgress = document.getElementById('chapter-progress');
        const chapterNumber = document.getElementById('chapter-progress-number');
        const chapterLabel = document.getElementById('chapter-progress-label');
        const chapterNext = document.getElementById('chapter-progress-next');
        const chapterPercent = document.getElementById('chapter-progress-percent');
        const chapters = [
            { selector: '#hero', label: 'Origin', next: 'Agent Runtime' },
            { selector: '#ai-vc-agent', label: 'Agent Runtime', next: 'Timeline' },
            { selector: '#timeline-container', label: 'Portfolio', next: 'Team' },
            { selector: '#projects-section', label: 'Team', next: 'Ecosystem' },
            { selector: '#ecosystem-section', label: 'Perspectives / Contact', next: 'Complete' }
        ].map((chapter) => ({ ...chapter, element: document.querySelector(chapter.selector) }))
            .filter((chapter) => chapter.element);

        if (chapterProgress && chapterNumber && chapterLabel && chapterNext && chapterPercent && chapters.length) {
            let activeChapterIndex = -1;
            let chapterSwitchTimer = 0;

            const renderChapterProgress = (index, progress) => {
                const normalized = Math.min(Math.max(progress, 0), 1);
                const remaining = Math.max(0, Math.round((1 - normalized) * 100));
                chapterProgress.style.setProperty('--chapter-progress', normalized.toFixed(4));
                chapterPercent.textContent = String(remaining).padStart(3, '0');

                if (index === activeChapterIndex) return;
                activeChapterIndex = index;
                const chapter = chapters[index];
                chapterNumber.textContent = String(index + 1).padStart(2, '0');
                chapterLabel.textContent = chapter.label;
                chapterNext.textContent = chapter.next;
                chapterProgress.dataset.chapter = chapter.label;
                chapterProgress.classList.add('is-switching');
                window.clearTimeout(chapterSwitchTimer);
                chapterSwitchTimer = window.setTimeout(() => {
                    chapterProgress.classList.remove('is-switching');
                }, 520);
            };

            const chapterControllers = chapters.map((chapter, chapterIndex) => ({
                ...chapter,
                chapterIndex,
                controller: chapter.selector === '#timeline-container'
                    ? tlTimeline.scrollTrigger
                    : chapterHoldTriggers.get(chapter.selector)
            })).filter((chapter) => chapter.controller);

            const updateChapterTelemetry = () => {
                let index = 0;
                for (let i = 0; i < chapterControllers.length; i += 1) {
                    if (window.scrollY >= chapterControllers[i].controller.start - 1) index = i;
                    else break;
                }

                const chapter = chapterControllers[index];
                const controller = chapter.controller;
                let progress = 0;
                if (window.scrollY < controller.start) progress = 0;
                else if (window.scrollY <= controller.end) progress = controller.progress;
                else progress = 1;

                renderChapterProgress(chapter.chapterIndex, progress);
            };

            window.setTimeout(() => chapterProgress.classList.add('is-ready'), 1850);
            lenis.on('scroll', updateChapterTelemetry);
            window.addEventListener('resize', updateChapterTelemetry);
            ScrollTrigger.addEventListener('refresh', updateChapterTelemetry);
            updateChapterTelemetry();
            ScrollTrigger.refresh();
        }

        const originReturnLinks = document.querySelectorAll(
            '.creekstone-final-footer a[href="#hero"], .creekstone-final-footer a[href="#top"]'
        );
        const syncOriginHash = () => {
            window.history.replaceState(
                null,
                "",
                `${window.location.pathname}${window.location.search}#top`
            );
        };
        const finishOriginReturn = () => {
            ScrollTrigger.update();
            restoreHeroScene(true);
            syncOriginHash();
            window.requestAnimationFrame(() => {
                ScrollTrigger.update();
                restoreHeroScene(true);
            });
        };

        originReturnLinks.forEach((link) => {
            link.addEventListener("click", (event) => {
                event.preventDefault();
                setTimelineMarkActive(false);

                if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
                    lenis.scrollTo(0, { immediate: true, force: true });
                    finishOriginReturn();
                    return;
                }

                lenis.scrollTo(0, {
                    duration: 1.35,
                    easing: (time) => Math.min(1, 1.001 - Math.pow(2, -10 * time)),
                    lock: true,
                    force: true,
                    onComplete: finishOriginReturn
                });
            });
        });
})();
