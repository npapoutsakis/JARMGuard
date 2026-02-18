/**
 *    Aho-Corasick - WebGPU Accelerated Pattern Matching
 *    Author: Nikolaos Papoutsakis
 *    Year: 2026
 */

import { saveAutomaton, savePatterns } from "./cache.js";
import { JARMFetcher } from "./jarmFetcher.js";

// Constant variables
const JARM_LENGTH = 62;

// size for hex characters (0-9, a-f)
const ALPHABET_SIZE = 16;

// workgroup size for GPU dispatch
const WORKGROUP_SIZE = 64;

// Mapping characters to indices (supports both uppercase and lowercase hex)
export function mapCharCode(code) {
  if (code >= 48 && code <= 57) {
    // '0' - '9'
    return code - 48;
  }
  if (code >= 97 && code <= 102) {
    // 'a' - 'f'
    return 10 + (code - 97);
  }
  // unkown character
  return -1; 
}

export class AhoCorasick {
  constructor() {
    this.max_batch = 1024;

    // webgpu
    this.device = null;
    this.queue = null;
    this.initialized = false;
    this.shaderModule = null;

    // automaton structures
    this.patterns = { blocklist: [], trackers: [] };
    this.table = { blocklist: null, trackers: null };
    this.output = { blocklist: null, trackers: null };
    this.num_states = { blocklist: 0, trackers: 0 };

    // GPU buffers
    this.transition_buffer = { blocklist: null, trackers: null };
    this.output_buffer = { blocklist: null, trackers: null };
    this.input_buffer = { blocklist: null, trackers: null };
    this.result_buffer = { blocklist: null, trackers: null };
    this.readback_buffer = { blocklist: null, trackers: null };

    // WebGPU pipelines and bind groups (cached for performance)
    this.compute_pipeline = { blocklist: null, trackers: null };
    this.bind_group = { blocklist: null, trackers: null };

    this.ready = { blocklist: false, trackers: false };

    // JARM Fetcher instance
    this.jarmFetcher = new JARMFetcher();
  }


  // WebGPU Adapter Initialization
  async init() {
    if (this.initialized) {
      return;
    }
    
    try {
      if (!navigator.gpu) {
        throw new Error("[ERROR] WebGPU not supported.");
      }
      
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) {
        throw new Error("[ERROR] Couldn't request WebGPU adapter.");
      }
      
      // get the maximums
      const maxStorageBuffer = adapter.limits.maxStorageBufferBindingSize;
      const maxBufferSize = adapter.limits.maxBufferSize;
      
      const requiredLimits = {
        maxStorageBufferBindingSize: maxStorageBuffer, 
        maxBufferSize: maxBufferSize,
      };

      this.device = await adapter.requestDevice({ requiredLimits });
      this.queue = this.device.queue;

      // Load and compile shader once
      const wgsl_url = chrome.runtime.getURL('payload.wgsl');
      const response = await fetch(wgsl_url);
      if (!response.ok) {
        throw new Error(`[ERROR] Failed to load shader: ${response.status}`);
      }
      const wgsl = await response.text();
      
      this.shaderModule = this.device.createShaderModule({ code: wgsl });

      this.initialized = true;
    } 
    catch (error) {
      console.error("[ERROR] WebGPU initialization failed:", error);
      this.initialized = false;
      throw error;
    }
  }


  // Load JARM patterns for a specific type.
  async loadPatterns(type) {
    if (!this.initialized) {
      console.warn("[WARN] Not initialized!");
      return;
    }
    
    // First, try to load from chrome.storage.local (updated patterns)
    const storageData = await chrome.storage.local.get(["jarms"]);
    if (storageData["jarms"] && storageData["jarms"][type]) {
      this.patterns[type] = storageData["jarms"][type];
      console.log(`[+] [${type}] Loaded ${this.patterns[type].length} patterns from storage`);
    } 
    else {
      // Fallback: fetch from GitHub
      console.log(`[+] [${type}] No patterns in storage, fetching from GitHub...`);
      if (type === 'blocklist') {
          this.patterns[type] = await this.jarmFetcher.fetch_blocklist_jarms();
      } 
      else if (type === 'trackers') {
          this.patterns[type] = await this.jarmFetcher.fetch_tracker_jarms();
      } else {
          console.error(`[ERROR] Invalid pattern type: ${type}`);
          return;
      }
    }
    // this.patterns[type] = type === 'blocklist' ? 
    //   await this.jarmFetcher.fetch_testing_jarms() :
    //   await this.jarmFetcher.fetch_tracker_jarms();
      
    await savePatterns(this.patterns[type], type);

    const start = performance.now();
    this.#buildDFA(type);
    const end = performance.now();
    console.log(`[+] [${type}] DFA built in ${(end - start).toFixed(2)} ms, ${this.patterns[type].length} patterns, ${this.num_states[type]} states.`);
    
    const prepareStart = performance.now();
    await this.prepareGPU(type);
    const prepareEnd = performance.now();
    console.log(`[+] [${type}] GPU resources prepared in ${(prepareEnd - prepareStart).toFixed(2)} ms.`);

    try {
      await saveAutomaton({
        num_states: this.num_states[type],
        table: this.table[type],
        output: this.output[type],
      }, type);
      console.log(`[+] [${type}] Automaton saved to cache.`);
    } 
    catch (error) {
      console.error(`[ERROR] [${type}] Error loading or processing patterns:`, error);
    }
  }

  #createNode() {
    return { 
      id: 0, 
      children: new Map(),
      fail: null,
      matchId: 0,
    };
  }


  #buildDFA(type) {
    if (!this.patterns[type] || this.patterns[type].length === 0) {
      throw new Error(`No patterns found for type: ${type}`);
    }

    const root = this.#createNode();
    const nodes = [root];
    
    // Build trie structure
    this.#buildTrie(type, root, nodes);
    
    // Build failure links
    this.#buildFailureLinks(root, nodes);
    
    // Convert to dense table representation
    this.#buildDenseTable(type, root, nodes);
  }

  #buildTrie(type, root, nodes) {
    for (let i = 0; i < this.patterns[type].length; i++) {
      const pattern = this.patterns[type][i];
      if (!pattern || pattern.length === 0) {
        console.warn(`Empty pattern at index ${i} for type ${type}`);
        continue;
      }
      
      let node = root;
      for (let ch = 0; ch < pattern.length; ch++) {
        const c = mapCharCode(pattern.charCodeAt(ch));
        if (c === -1) {
          console.warn(`Invalid character in pattern ${i} at position ${ch}`);
          continue;
        }
        
        if (!node.children.has(c)) {
          const child = this.#createNode();
          child.id = nodes.length;
          node.children.set(c, child);
          nodes.push(child);
        }
        node = node.children.get(c);
      }
      node.matchId = 1; // Boolean match (1=true, 0=false)
    }
  }

  #buildFailureLinks(root, nodes) {
    // Initialize root failure link
    root.fail = root;
    const queue = [];
    
    // Set failure links for depth-1 nodes
    for (let c = 0; c < ALPHABET_SIZE; c++) {
      if (root.children.has(c)) {
        const child = root.children.get(c);
        child.fail = root;
        queue.push(child);
      }
    }

    // BFS to set failure links for deeper nodes
    let head = 0;
    while (head < queue.length) {
      const current = queue[head++];
      
      for (const [c, child] of current.children) {
        // Find the failure link
        let fail = current.fail;
        while (fail !== root && !fail.children.has(c)) {
          fail = fail.fail;
        }
        
        // Set the failure link
        if (fail.children.has(c) && fail.children.get(c) !== child) {
          child.fail = fail.children.get(c);
        } else {
          child.fail = root;
        }
        
        
        // Propagate match ID (prefer local match, else inherit failure match)
        child.matchId = child.matchId || child.fail.matchId;
        
        queue.push(child);
      }
    }
  }

  #buildDenseTable(type, root, nodes) {
    this.num_states[type] = nodes.length;
    this.table[type] = new Uint32Array(this.num_states[type] * ALPHABET_SIZE);
    this.output[type] = new Uint32Array(this.num_states[type]);

    for (let state = 0; state < this.num_states[type]; state++) {
      const node = nodes[state];
      
      // Store output information (Pattern ID)
      this.output[type][state] = node.matchId;
      
      // Build transition table
      for (let c = 0; c < ALPHABET_SIZE; c++) {
        const nextState = this.#findNextState(node, c, root);
        this.table[type][state * ALPHABET_SIZE + c] = nextState;
      }
    }
  }

  #findNextState(node, c, root) {
    let current = node;
    while (current !== root && !current.children.has(c)) {
      current = current.fail;
    }
    
    if (current.children.has(c)) {
      return current.children.get(c).id;
    }
    return 0;
  }


  async prepareGPU(type) {
    if (!this.initialized) {
      console.warn(`[!] [${type}] Not initialized!`);
      return;
    }
    if (!this.table[type] || !this.output[type]) {
      console.error(`[-] [${type}] No cached table`);
      return;
    }
    
    this.#destroy(type);
    return await this.#init_resources(type);
  }


  async #init_resources(type) {
    try {
      this.device.pushErrorScope('validation');

      this.input_buffer[type] = this.device.createBuffer({
        label: `input_${type}`,
        size: JARM_LENGTH * 4 * this.max_batch,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });

      this.result_buffer[type] = this.device.createBuffer({
        label: `result_${type}`,
        size: this.max_batch * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      });

      this.readback_buffer[type] = this.device.createBuffer({
        label: `readback_${type}`,
        size: this.max_batch * 4,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });

      this.transition_buffer[type] = this.device.createBuffer({
        label: `transitions_${type}`,
        size: this.table[type].byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.queue.writeBuffer(this.transition_buffer[type], 0, this.table[type]);

      this.output_buffer[type] = this.device.createBuffer({
        label: `output_flags_${type}`,
        size: this.output[type].byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.queue.writeBuffer(this.output_buffer[type], 0, this.output[type]);
      
      const bindGroupLayout = this.device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
          { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
          { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
          { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        ]
      });

      const pipelineLayout = this.device.createPipelineLayout({
        bindGroupLayouts: [bindGroupLayout],
      });

      this.compute_pipeline[type] = this.device.createComputePipeline({
        layout: pipelineLayout,
        compute: { 
          module: this.shaderModule, 
          entryPoint: "main" 
        },
      });
      
      // Create and cache bind group using the explicit layout
      this.bind_group[type] = this.device.createBindGroup({
        layout: bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.transition_buffer[type] } },
          { binding: 1, resource: { buffer: this.output_buffer[type] } },
          { binding: 2, resource: { buffer: this.input_buffer[type] } },
          { binding: 3, resource: { buffer: this.result_buffer[type] } },
        ],
      });

      this.ready[type] = true;
      const start = performance.now();
      await this.#warmup(type);
      const duration = performance.now() - start;
      console.log(`[+] [${type}] Warm-up scan completed in ${duration.toFixed(2)} ms`);
      console.log(`[+] [${type}] WebGPU pipeline ready.`);
    }
    catch (error) {
      this.ready[type] = false;
      console.error(`[ERROR] [${type}] Error preparing GPU computation:`, error);
    }
  }

  // just perform a scan to warmup the pipeline
  async #warmup(type) {
    return await this.match(["00000000000000000000000000000000000000000000000000000000000000"], type);
  }

  // reset all buffers
  #destroy(type) {
    if (this.input_buffer[type]) {
      this.input_buffer[type].destroy();
      this.input_buffer[type] = null;
    }
    if (this.result_buffer[type]) {
      this.result_buffer[type].destroy();
      this.result_buffer[type] = null;
    }
    if (this.readback_buffer[type]) {
      this.readback_buffer[type].destroy();
      this.readback_buffer[type] = null;
    }
    if (this.transition_buffer[type]) {
      this.transition_buffer[type].destroy();
      this.transition_buffer[type] = null;
    }
    if (this.output_buffer[type]) {
      this.output_buffer[type].destroy();
      this.output_buffer[type] = null;
    }
    
    this.bind_group[type] = null;
    this.compute_pipeline[type] = null;
    this.ready[type] = false;
  }

  async match(jarms, type) {
    console.time(`[+] [${type}] Match`);

    if (!this.ready[type]) {
      throw new Error(`[${type}] Automaton not ready for match()!`);
    }

    let input_data = new Uint32Array(jarms.length * JARM_LENGTH);
    for (let i = 0; i < jarms.length; i++) {
      const jarm = jarms[i];
      const offset = i * JARM_LENGTH;
      for (let j = 0; j < JARM_LENGTH; j++) {
        input_data[offset + j] = mapCharCode(jarm.charCodeAt(j));
      }
    }
    
    // Upload input data to GPU
    this.queue.writeBuffer(this.input_buffer[type], 0, input_data.buffer, 0, input_data.byteLength);
    
    const command_encoder = this.device.createCommandEncoder();
    const compute_pass = command_encoder.beginComputePass();
    compute_pass.setPipeline(this.compute_pipeline[type]);
    compute_pass.setBindGroup(0, this.bind_group[type]);
    
    const numWorkgroups = Math.ceil(jarms.length / WORKGROUP_SIZE);
    compute_pass.dispatchWorkgroups(numWorkgroups);
    compute_pass.end();
    
    command_encoder.copyBufferToBuffer(
      this.result_buffer[type], 
      0, 
      this.readback_buffer[type], 
      0, 
      jarms.length * 4
    );
    
    this.queue.submit([command_encoder.finish()]);
  
    try {
      await this.readback_buffer[type].mapAsync(GPUMapMode.READ, 0, jarms.length * 4);
      const data = new Uint32Array(this.readback_buffer[type].getMappedRange(0, jarms.length * 4));
      const results = Array.from(data, (value) => value === 1);
      console.timeEnd(`[+] [${type}] Match`);
      return results;
    }
    catch (error) {
      console.error(`[ERROR] [${type}] Match readback failed:`, error);
      throw error;
    }
    finally {
      this.readback_buffer[type].unmap(); // send to gpu again
    }
  }
}