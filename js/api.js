function updateWordCount() {
    const text = document.getElementById('essayInput').value.trim();
    
    // Smart split: only counts actual words and numbers
    const wordsArray = text.split(/\s+/).filter(word => /[a-zA-Z0-9]/.test(word));
    const wordCount = text.length > 0 ? wordsArray.length : 0;
    
    const display = document.getElementById('wordCountDisplay');
    display.innerText = `${wordCount} words`;
    
    // The Traffic Light Logic
    if (wordCount === 0) {
        display.style.color = "#64748b"; // Gray: Not started
    } else if (wordCount > 450) {
        display.style.color = "#ef4444"; // Red: Warning! Too long!
        display.innerText = `${wordCount} words (Careful, keep it concise!)`;
    } else if (wordCount >= 350) {
        display.style.color = "#16a34a"; // Green: Perfect for Task 2!
    } else {
        display.style.color = "#2563eb"; // Blue: Keep writing...
    }
}

async function gradeEssay() {
    const essay = document.getElementById('essayInput').value;
    const currentTask = writingTasks[currentTaskIndex];
    const submitBtn = document.getElementById('submitBtn');
    const resultsBox = document.getElementById('results-box');

    if (!essay || essay.split(/\s+/).length < 5) {
        alert("Please write something before submitting!");
        return;
    }

    // UI Loading State
    submitBtn.innerText = "Grading... Please Wait";
    submitBtn.disabled = true;

    try {
        const response = await fetch('https://muet-hub-api.onrender.com/grade-writing', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                answer: essay,
                taskType: currentTask.type,
                prompt: currentTask.prompt
            })
        });

        const result = await response.json();
        resultsBox.style.display = 'block';
        const bandValue = result.band || "N/A";
        const bandDisplay = document.getElementById('bandDisplay');

        bandDisplay.innerText = `Estimated Grade: ${bandValue}`;
        bandDisplay.style.fontSize = "22px";
        bandDisplay.style.fontWeight = "700";
        bandDisplay.style.color = "#16a34a"; // A nice deep MUET blue

        // Match the JSON keys exactly
        document.getElementById('strengthsDisplay').innerText = result.strengths || "No data";
        document.getElementById('weaknessesDisplay').innerText = result.improvements || "No data";
        document.getElementById('vocabDisplay').innerText = result.suggestion || "No data";
        
        // Scroll to results
        resultsBox.scrollIntoView({ behavior: 'smooth' });

    } catch (error) {
        console.error("Grading failed:", error);
        alert("Server error. Make sure your backend is running!");
    } finally {
        submitBtn.innerText = "Grade My Essay";
        submitBtn.disabled = false;
    }
}