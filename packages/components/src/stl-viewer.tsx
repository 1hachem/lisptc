import { useEffect, useRef, useState } from "react";
import {
	Box3,
	type BufferGeometry,
	DirectionalLight,
	HemisphereLight,
	Mesh,
	MeshStandardMaterial,
	PerspectiveCamera,
	Scene,
	Sphere,
	WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { cssColorHex } from "./css-color.ts";

type Status = "loading" | "shown" | { error: string };

export interface StlViewerProps {
	url: string;
	name: string;
}

async function fetchArrayBuffer(url: string): Promise<ArrayBuffer> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`fetch failed (${response.status})`);
	return await response.arrayBuffer();
}

function framed(camera: PerspectiveCamera, bounds: Sphere) {
	const fov = (camera.fov * Math.PI) / 180;
	const distance = (bounds.radius / Math.sin(fov / 2)) * 1.1;
	camera.near = distance / 100;
	camera.far = distance * 100;
	camera.position
		.set(1, 0.8, 1.2)
		.normalize()
		.multiplyScalar(distance)
		.add(bounds.center);
	camera.lookAt(bounds.center);
	camera.updateProjectionMatrix();
}

export function stlGeometry(bytes: ArrayBuffer): BufferGeometry {
	const geometry = new STLLoader().parse(bytes);
	if (!geometry.getAttribute("position")?.count)
		throw new Error("this STL holds no triangles");
	if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
	return geometry;
}

export function StlViewer({ url, name }: StlViewerProps) {
	const host = useRef<HTMLDivElement>(null);
	const [status, setStatus] = useState<Status>("loading");

	useEffect(() => {
		const element = host.current;
		if (!element) return;
		setStatus("loading");

		let renderer: WebGLRenderer;
		try {
			renderer = new WebGLRenderer({ antialias: true, alpha: true });
		} catch {
			setStatus({ error: "this browser cannot draw 3D (no WebGL)" });
			return;
		}
		renderer.setPixelRatio(window.devicePixelRatio);
		renderer.domElement.className = "block h-full w-full";
		renderer.domElement.setAttribute("aria-label", name);
		element.append(renderer.domElement);

		const scene = new Scene();
		scene.add(new HemisphereLight(0xffffff, 0x444444, 2));
		const key = new DirectionalLight(0xffffff, 2);
		const camera = new PerspectiveCamera(40, 1, 0.1, 1000);
		camera.add(key);
		key.position.set(1, 1, 0);
		scene.add(camera);

		const controls = new OrbitControls(camera, renderer.domElement);
		controls.enableDamping = true;

		const material = new MeshStandardMaterial({
			color: cssColorHex(getComputedStyle(element).color) ?? 0x888888,
			metalness: 0.1,
			roughness: 0.6,
		});
		let geometry: BufferGeometry | undefined;
		let disposed = false;

		const resize = () => {
			const { clientWidth: width, clientHeight: height } = element;
			if (width === 0 || height === 0) return;
			renderer.setSize(width, height, false);
			camera.aspect = width / height;
			camera.updateProjectionMatrix();
		};
		const observer = new ResizeObserver(resize);
		observer.observe(element);
		resize();

		renderer.setAnimationLoop(() => {
			controls.update();
			renderer.render(scene, camera);
		});

		fetchArrayBuffer(url)
			.then((bytes) => {
				if (disposed) return;
				geometry = stlGeometry(bytes);
				const mesh = new Mesh(geometry, material);
				scene.add(mesh);
				const bounds = new Box3()
					.setFromObject(mesh)
					.getBoundingSphere(new Sphere());
				framed(camera, bounds);
				controls.target.copy(bounds.center);
				controls.update();
				setStatus("shown");
			})
			.catch((error: unknown) => {
				if (disposed) return;
				setStatus({
					error: error instanceof Error ? error.message : String(error),
				});
			});

		return () => {
			disposed = true;
			observer.disconnect();
			renderer.setAnimationLoop(null);
			controls.dispose();
			geometry?.dispose();
			material.dispose();
			renderer.dispose();
			renderer.domElement.remove();
		};
	}, [url, name]);

	return (
		<div ref={host} className="relative h-full w-full text-fg">
			{status !== "shown" && (
				<div
					role="status"
					className="absolute inset-0 flex items-center justify-center text-dim"
				>
					{status === "loading" ? "loading…" : status.error}
				</div>
			)}
		</div>
	);
}
