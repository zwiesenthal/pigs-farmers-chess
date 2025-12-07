import { WorkerGameController } from './WorkerGameController';
import { UIRenderer } from './UIRenderer';
import '../styles/main.css';

declare global {
  interface Window {
    PigsAndFarmersModule: () => Promise<any>;
  }
}

async function main() {
  const loadingEl = document.getElementById('loading');
  const appEl = document.getElementById('app');

  try {
    // Initialize game controller with Web Worker for off-main-thread computation
    const controller = new WorkerGameController();
    await controller.initialize();

    // Initialize UI
    const renderer = new UIRenderer(controller);

    // Initial render - fetch initial state
    const initialState = await controller.getBoardState();
    renderer.render(initialState);

    // Hide loading, show app
    if (loadingEl) loadingEl.style.display = 'none';
    if (appEl) appEl.style.display = 'flex';

    console.log('Pigs and Farmers initialized successfully (Web Worker mode)');
  } catch (error) {
    console.error('Failed to initialize:', error);
    if (loadingEl) {
      loadingEl.innerHTML = `
        <div class="error">
          <h2>Failed to load game engine</h2>
          <p>Please make sure WebAssembly is supported in your browser.</p>
          <p>Error: ${error}</p>
        </div>
      `;
    }
  }
}

// Wait for DOM and WASM module
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
