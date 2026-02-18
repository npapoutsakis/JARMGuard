@group(0) @binding(0) var<storage, read> transition_table: array<u32>;
@group(0) @binding(1) var<storage, read> output: array<u32>;
@group(0) @binding(2) var<storage, read> inputs: array<u32>;
@group(0) @binding(3) var<storage, read_write> result: array<u32>;

const ALPHABET_SIZE: u32 = 16u;
const JARM_LENGTH: u32 = 62u;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  let thread_id = id.x;
  var state: u32 = 0u;
  var found: u32 = 0u;

  // calculate the starting point of each thread on the input buffer
  let base = thread_id * JARM_LENGTH;

  for (var i: u32 = 0u; i < JARM_LENGTH; i++) {
    let char: u32 = inputs[base + i];
    
    // transition on the table to find next state
    state = transition_table[state * ALPHABET_SIZE + char];

    // bitwise to avoid branching
    found = found | output[state];
  }

  result[thread_id] = found;
}