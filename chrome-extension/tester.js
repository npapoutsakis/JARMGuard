/**
 *  Tester (tester.js)
 *  Performs CPU/GPU benchmark
 * 
 *  Author: Nikolaos Papoutsakis
*/

/*
 * gpu_match_test
 */
export async function gpu_match_test(jarms, aho, type) {
  return await aho.match(jarms, type);
}

/*
 * cpu_worker_test
 */
export async function cpu_worker_test(jarms, type) {

  // create the doc that the workers will run
  await chrome.offscreen.createDocument({ 
    url: 'tester.html',
    reasons: ['WORKERS'], // offscreen.CreateParameters
    justification: 'Running CPU benchmark',
  });

  const response = await chrome.runtime.sendMessage({
    type: 'testThreadWorkers',
    data: { 
      type: type,
      jarms: jarms
    }
  });
  console.log(`[CPU Worker] Time: ${response.time.toFixed(2)} ms`);

  // close the doc 
  await chrome.offscreen.closeDocument();
}