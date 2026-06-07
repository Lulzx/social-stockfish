import "./styles.css";

const bridgeStatus = document.querySelector("#bridge-status");
const hasBridge = typeof window !== "undefined" && Boolean(window.zero);

bridgeStatus.textContent = hasBridge ? "available" : "not enabled";
bridgeStatus.dataset.ready = "true";
