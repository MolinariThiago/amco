/**
 * Vercel Speed Insights Integration
 * This file initializes Vercel Speed Insights for tracking web vitals.
 */

// Initialize the queue for Speed Insights
(function() {
  if (window.si) return;
  window.si = function() {
    (window.siq = window.siq || []).push(arguments);
  };
})();

// Inject the Speed Insights script
(function() {
  // Only run in production (when deployed to Vercel)
  const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  
  if (isDev) {
    console.log('[Speed Insights] Running in development mode - metrics will not be collected');
    return;
  }

  // Create and inject the Speed Insights script
  const script = document.createElement('script');
  script.src = '/_vercel/speed-insights/script.js';
  script.defer = true;
  
  // Add dataset attributes for SDK identification
  script.dataset.sdkn = '@vercel/speed-insights';
  script.dataset.sdkv = '2.0.0';
  
  script.onerror = function() {
    console.log('[Vercel Speed Insights] Failed to load script. Please check if any content blockers are enabled.');
  };
  
  document.head.appendChild(script);
})();
