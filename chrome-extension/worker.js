/**
 *    Worker for Aho-Corasick CPU Search
 *    Runs in a separate thread.
*/

function mapCharCode(code) {
  if (code >= 48 && code <= 57) {
    // '0' - '9'
    return code - 48;
  }
  if (code >= 97 && code <= 102) {
    // 'a' - 'f'
    return 10 + (code - 97);
  }
  return -1; 
}

// Worker for Aho-Corasick CPU Search
self.onmessage = function(e) {
  const { table, output, jarms } = e.data;
  
  // Create views on the SharedArrayBuffers
  const tableArray = new Uint32Array(table);
  const outputArray = new Uint32Array(output);

  const ALPHABET_SIZE = 16;
  const results = [];
  
  for (const jarm of jarms) {
    let state = 0;
    let found = false;

    for (let i = 0; i < jarm.length; i++) {
      let c = mapCharCode(jarm.charCodeAt(i));
      state = tableArray[state * ALPHABET_SIZE + c];
      found = outputArray[state] === 1;
    }

    results.push(found);
  }
  
  self.postMessage({ type: 'result', data: results });
};
