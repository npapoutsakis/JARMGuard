/**
 *    Cache (cache.js)
 *    Cache API for storing and retrieving the automaton
 *
 *    Author: Nikolaos Papoutsakis
*/


// Constants
const AUTOMATON_CACHE_NAME = "automaton_cache";


// Paths for cache requests
// eg. type can be 'blocklist' or 'trackers', so 2 different automatons
function getNumStates(type) {
  return `https://cache/automaton/${type}/num_states`;  
}

function getTable(type) {
  return `https://cache/automaton/${type}/table`;
}

function getOutput(type) {
  return `https://cache/automaton/${type}/output`;
} 

function getPatterns(type) {
  return `https://cache/automaton/${type}/patterns`;
}

/**
 * Save the automaton into Cache
 * { num_states: Integer, table: Uint32Array, output: Uint32Array }
 */
export async function saveAutomaton(automaton, type) {

  if (!type) {
    console.error("[-] type is not defined!");
    return;
  }

  try {
    const cache = await caches.open(AUTOMATON_CACHE_NAME);

    const states = new Response(String(automaton.num_states));
    const table = new Response(automaton.table);
    const output = new Response(automaton.output);

    await cache.put(getNumStates(type), states);
    await cache.put(getTable(type), table);
    await cache.put(getOutput(type), output);
  } 
  catch (error) {
    console.error("[-] saveAutomaton (CacheAPI) failed:", error);
  }
}


/**
 * Load the automaton from Cache
 * Returns { num_states: Integer, table: Uint32Array, output: Uint32Array }
 */
export async function loadAutomaton(type) {
  try {
    const startTime = performance.now();
    const cache = await caches.open(AUTOMATON_CACHE_NAME);

    const states_response = await cache.match(getNumStates(type));
    const table_response = await cache.match(getTable(type));
    const output_response = await cache.match(getOutput(type));
    
    if (!states_response || !table_response || !output_response) {
      console.log(`[-] Automaton with type '${type}' not found in cache`);
      return null;
    }

    const num_states = parseInt(await states_response.text());
    const table = new Uint32Array(await table_response.arrayBuffer());
    const output = new Uint32Array(await output_response.arrayBuffer());
    
    const endTime = performance.now();
    console.log(`[+] Automaton '${type}' loaded from cache in ${(endTime - startTime).toFixed(2)} ms`);
    
    return { 
      num_states, 
      table, 
      output 
    };

  }
  catch (error) {
    console.error("[-] loadAutomaton failed:", error);
    return null;
  }
}


/**
 * Save the patterns list to Cache (for testing purposes)
 */
export async function savePatterns(patterns, type) {
  try {
    const cache = await caches.open(AUTOMATON_CACHE_NAME);
    const response = new Response(JSON.stringify(patterns));
    await cache.put(getPatterns(type), response);
    console.log(`[+] Patterns '${type}' saved to cache.`);
  } 
  catch (error) {
    console.error("[-] Saving patterns failed:", error);
  }
}


/**
 * Load the patterns from cache
 */
export async function fetchCachedPatterns(type) {
  try {
    const cache = await caches.open(AUTOMATON_CACHE_NAME);
    const response = await cache.match(getPatterns(type));

    return JSON.parse(await response.text());
  }
  catch (error) {
    console.error("[-] Loading patterns failed:", error);
    return null;
  }
}


/**
 * Clear the cache
 */
export async function clearCache(type) {
  try {
    const cache = await caches.open(AUTOMATON_CACHE_NAME);
    await cache.delete(getNumStates(type));
    await cache.delete(getTable(type));
    await cache.delete(getOutput(type));
  } 
  catch (error) {
    console.error("[-] clearAutomatonCache failed:", error);
  }
}