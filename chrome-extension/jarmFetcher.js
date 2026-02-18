/**
 *  JARM Fetcher (jarmFetcher.js)
 *  JARM Fetcher is responsible for fetching and updating the malicious jarms from git repository.
 * 
 *  Author: Nikolaos Papoutsakis
 */

// Public dataset default URL
// The default URL for the public dataset is set to a specific path on github
const blocklist = "https://raw.githubusercontent.com/npapoutsakis/domain_dataset/refs/heads/main/final/cleaned_dataset.csv";
const trackers = "https://raw.githubusercontent.com/npapoutsakis/domain_dataset/refs/heads/main/final/ad_trackers.csv";
const testing = {
  1: "https://raw.githubusercontent.com/npapoutsakis/domain_dataset/refs/heads/main/tests/50.csv",
  2: "https://raw.githubusercontent.com/npapoutsakis/domain_dataset/refs/heads/main/tests/100.csv",
  3: "https://raw.githubusercontent.com/npapoutsakis/domain_dataset/refs/heads/main/tests/250.csv",
  4: "https://raw.githubusercontent.com/npapoutsakis/domain_dataset/refs/heads/main/tests/500.csv",
  5: "https://raw.githubusercontent.com/npapoutsakis/domain_dataset/refs/heads/main/tests/1000.csv",
  6: "https://raw.githubusercontent.com/npapoutsakis/domain_dataset/refs/heads/main/tests/2000.csv",
  7: "https://raw.githubusercontent.com/npapoutsakis/domain_dataset/refs/heads/main/tests/2500.csv",
  8: "https://raw.githubusercontent.com/npapoutsakis/domain_dataset/refs/heads/main/tests/5000.csv",
  9: "https://raw.githubusercontent.com/npapoutsakis/domain_dataset/refs/heads/main/tests/10000.csv",
  10: "https://raw.githubusercontent.com/npapoutsakis/domain_dataset/refs/heads/main/tests/15000.csv",
  11: "https://raw.githubusercontent.com/npapoutsakis/domain_dataset/refs/heads/main/tests/20000.csv",
  12: "https://raw.githubusercontent.com/npapoutsakis/domain_dataset/refs/heads/main/tests/50000.csv",
  13: "https://raw.githubusercontent.com/npapoutsakis/domain_dataset/refs/heads/main/tests/100000.csv",
}

export class JARMFetcher {
  
  // Constructor
  constructor() {

    this.testing_dataset = {
      1: testing[13]
    }

    this.blocklist_dataset = {
      1: blocklist,
    }

    this.tracker_dataset = {
      1: trackers,
    }
  }


  /**
   * Fetches all data from the datasets
   */
  async #fetch_raw_datasets(dataset) {

    // list of all jarm fingerprints
    const jarm_list = [];

    try {
      // loop & fetch file in the public dataset      
      for (let key in dataset) {
        
        const response = await fetch(dataset[key]);

        if (!response.ok) {
          throw new Error("Failed to fetch JARM dataset");
        }
        
        // read the response as text
        const data = await response.text();

        const lines = data.trim().split("\n");
        for (let i = 0; i < lines.length; i++) {
          jarm_list.push(lines[i]);
        }
      }
      // remove duplicates
      const unique_ones = new Set(jarm_list);

      return Array.from(unique_ones);
    } 
    catch (error) {
      console.error("[ERROR] Fetch Error:", error);
    }
  }

  // Blocklist
  async fetch_blocklist_jarms() {
    const jarms = await this.#fetch_raw_datasets(this.blocklist_dataset);
    return jarms;
  }

  // Ad/Trackers
  async fetch_tracker_jarms() {
    const jarms = await this.#fetch_raw_datasets(this.tracker_dataset);
    return jarms;
  }

  // Testing
  async fetch_testing_jarms() {
    const jarms = await this.#fetch_raw_datasets(this.testing_dataset);
    return jarms;
  }

}


// Testing the JARMFetcher
// (async () => {
//   const jarmFetcher = new JARMFetcher();
//   const maliciousJarms = await jarmFetcher.fetch_blocklist_jarms();
  
//   if (maliciousJarms) {
//     maliciousJarms.forEach((line) => {
//       console.log(line);
//     });
//   } 
//   else {
//     console.error("[ERROR] Failed to fetch malicious jarms.");
//   }
// }
// )();


// End of Jarm Fetcher (jarmFetcher.js)
