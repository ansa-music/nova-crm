import gsap from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

/** Calm product motion — 200–400ms, no bounce. */
export const deskEase = "power2.out";

export { gsap, useGSAP };
