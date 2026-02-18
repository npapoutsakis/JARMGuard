document.addEventListener('DOMContentLoaded', () => {
    
    // on each popup load show the current state of the extension
    (async () => {
        // get the active tab & check if active
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const storage = await chrome.storage.local.get('active');
        const isActive = storage['active'] || false;
        
        // set the switch to the correct state
        const activationSwitch = document.getElementById('activation_toggle');
        activationSwitch.checked = isActive;
        
        // update the status label accordingly
        const statusLabel = document.querySelector('.status-label');
        statusLabel.querySelector('span').textContent = isActive ? 'Protected' : 'Disabled';
        statusLabel.querySelector('span').style.color = isActive ? '' : 'Gray';
        statusLabel.querySelector('.status-dot').style.backgroundColor = isActive ? '' : 'Gray';
        
        // show the current domain
        const url = new URL(tab.url);
        const domain = document.getElementById('current-domain');
        domain.textContent = (url.protocol.startsWith('chrome')) ? 'Internal Page' : url.hostname;
        
        // show the tracker count for that tab
        const data = await chrome.storage.local.get('trackers');
        const counts = data['trackers'];
        const trackers = document.getElementById('counted-number');
        trackers.textContent = counts[tab.id] || 0;
    })();

    // event listener for the activation switch
    const activationSwitch = document.getElementById('activation_toggle');
    activationSwitch.addEventListener('change', 
        async (event) => {
            const isActive = event.target.checked;
            const statusLabel = document.querySelector('.status-label');
            statusLabel.querySelector('span').textContent = isActive ? 'Protected' : 'Disabled';
            statusLabel.querySelector('span').style.color = isActive ? '' : 'Gray';
            statusLabel.querySelector('.status-dot').style.backgroundColor = isActive ? '' : 'Gray';
            await chrome.storage.local.set({ 'active' : isActive });
        }
    );
    
    // listener for the state of the extension
    const trackers = document.getElementById('counted-number');
    chrome.storage.onChanged.addListener(async (changes, namespace) => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (namespace === 'local' && changes.trackers) {
            const updatedSet = changes.trackers.newValue;
            trackers.textContent = updatedSet[tab.id];
        }
    });
    
    // update dataset button
    const refreshButton = document.getElementById('refresh_button');
    refreshButton.addEventListener('click', () => {
        // make a simple rotation animation
        refreshButton.animate(
            [
                { transform: 'rotate(0deg)' },
                { transform: 'rotate(360deg)' }
            ],
            {
                duration: 1000,
                iterations: 1
            }
        );
        chrome.runtime.sendMessage({ action: 'updateJarmDataset' }, 
            (response) => {
                if (response.status === 'success') {
                    console.log('[+] JARM dataset updated successfully');
                } else {
                    console.error('[-] Failed to update JARM dataset:', response);
                }
            }
        );
    });

});