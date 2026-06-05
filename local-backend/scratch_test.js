async function runVerification() {
    console.log("Fetching gallery items...");
    const galleryRes = await fetch("http://localhost:5002/api/gallery");
    const gallery = await galleryRes.json();
    
    // Choose an item with a valid thumbnail
    const targetItem = gallery.find(i => i.thumbnailPath);
    if (!targetItem) {
        console.log("No valid item found with a thumbnail.");
        return;
    }
    
    console.log(`\n--- TESTING SINGLE-TRIGGER CRITIQUE FOR: ${targetItem.fileName} ---`);
    
    // Fetch chat history before test
    const chatBeforeRes = await fetch(`http://localhost:5002/api/gallery/${targetItem.id}/chat`);
    const chatBefore = await chatBeforeRes.json();
    console.log(`Chat messages before test: ${chatBefore.history.length}`);
    
    // 1. Manually force the database to flag needsCritique: true for this drawing
    // (This simulates a fresh Chokidar "change/save" event)
    console.log("Simulating file save by flagging needsCritique: true in database...");
    const db = require('./db');
    db.saveGalleryEntry({
        id: targetItem.id,
        needsCritique: true
    });
    
    // 2. Perform concurrent access requests to verify concurrency lock prevents duplicate triggers!
    console.log("Sending 3 concurrent POST /access requests simultaneously...");
    const promises = [
        fetch(`http://localhost:5002/api/gallery/${targetItem.id}/access`, { method: 'POST' }),
        fetch(`http://localhost:5002/api/gallery/${targetItem.id}/access`, { method: 'POST' }),
        fetch(`http://localhost:5002/api/gallery/${targetItem.id}/access`, { method: 'POST' })
    ];
    
    const responses = await Promise.all(promises);
    const results = await Promise.all(responses.map(r => r.json()));
    console.log("Concurrent access trigger results loaded.");
    
    // 3. Wait for the async AI API bridge call to finish
    console.log("Waiting 12 seconds for the single background critique to complete...");
    await new Promise(resolve => setTimeout(resolve, 12000));
    
    // 4. Check chat history length again
    const chatAfterRes = await fetch(`http://localhost:5002/api/gallery/${targetItem.id}/chat`);
    const chatAfter = await chatAfterRes.json();
    console.log(`Chat messages after concurrent triggers: ${chatAfter.history.length}`);
    
    const difference = chatAfter.history.length - chatBefore.history.length;
    console.log(`Diff: +${difference} messages added to chat history.`);
    
    if (difference === 1) {
        console.log("SUCCESS: Only ONE critique was triggered and added! Concurrency lock successfully blocked duplicate calls.");
    } else if (difference > 1) {
        console.log(`FAILED: Multiple critiques (${difference}) were triggered!`);
    } else {
        console.log("FAILED: No critique was triggered.");
    }
    
    // 5. Test another immediate access call to verify that once needsCritique is false, no API calls are made
    console.log("\nTriggering a subsequent access call immediately (needsCritique should be false)...");
    await fetch(`http://localhost:5002/api/gallery/${targetItem.id}/access`, { method: 'POST' });
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const chatFinalRes = await fetch(`http://localhost:5002/api/gallery/${targetItem.id}/chat`);
    const chatFinal = await chatFinalRes.json();
    console.log(`Chat history length after secondary access: ${chatFinal.history.length}`);
    
    if (chatFinal.history.length === chatAfter.history.length) {
        console.log("SUCCESS: Subsequent accesses correctly ignored requesting more critiques!");
    } else {
        console.log("FAILED: Subsequent accesses triggered critiques again.");
    }
}

runVerification().catch(err => console.error("Verification script error:", err));
