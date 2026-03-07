// js/navbar.js

function loadNavbar() {
    // 1. The unified HTML for your navigation bar
    const navbarHTML = `
        <nav class="navbar">
            <a href="index.html" id="link-index">✍️ Writing Grader</a>
            <a href="reading.html" id="link-reading">📖 Reading Practice</a>
            <a href="resources.html" id="link-resources">📂 Past Year Resources</a>
            <a href="admin.html" id="link-admin">⚙️ Resource Upload</a>
        </nav>
    `;

    // 2. Inject it into the page
    const placeholder = document.getElementById('nav-placeholder');
    if (placeholder) {
        placeholder.innerHTML = navbarHTML;
    }

    // 3. Highlight the active tab
    // Get the current file name from the URL (e.g., "reading.html")
    let currentPath = window.location.pathname.split("/").pop();
    
    // If it's empty (like just "localhost:3000/"), default to index
    if (currentPath === "") {
        currentPath = "index.html";
    }

    // Find the link that matches the current path and add the 'active' class
    const activeLinkId = `link-${currentPath.replace('.html', '')}`;
    const activeLinkElement = document.getElementById(activeLinkId);
    
    if (activeLinkElement) {
        activeLinkElement.classList.add('active');
    }
}

// Run the function as soon as the file loads
loadNavbar();