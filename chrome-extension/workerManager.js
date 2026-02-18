/**
 *  Handles the creation of web workers for the CPU benchmarks
 *  ---> IMPORTANT: include the offscreen permission on the manifest file for this to work
*/

import { loadAutomaton } from './cache.js';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'testThreadWorkers') {
    runTest(message.data, sendResponse);
    return true;
  }
});

async function runTest({ type, jarms }, sendResponse) {
  
  // fetch the dataset once in main thread
  const dataset = await loadAutomaton(type);
  const { table, output } = dataset;
  
  // make a reference to all workes so we dont create
  const referencedTable = new SharedArrayBuffer(table.byteLength);
  const referencedOutput = new SharedArrayBuffer(output.byteLength);

  new Uint32Array(referencedTable).set(table)
  new Uint32Array(referencedOutput).set(output)

  // split by hardware concurrency (cores)
  const chunkSize = Math.ceil(jarms.length / navigator.hardwareConcurrency);
  const jobs = [];

  // for all available cores -> create the job
  for (let i = 0; i < navigator.hardwareConcurrency; i++) {
    const chunk = jarms.slice(i * chunkSize, (i + 1) * chunkSize);
    
    jobs.push(new Promise((resolve) => {
      const worker = new Worker('worker.js');
      
      worker.onmessage = (e) => {
        worker.terminate();
        resolve(e.data);
      };

      worker.postMessage({
        table: referencedTable,
        output: referencedOutput,
        jarms: chunk
      });
    }));
  }
  
  const start = performance.now();
  await Promise.all(jobs);    // wait for all workers
  sendResponse({
    status: 'success',
    time: performance.now() - start 
  });
  return;
}
