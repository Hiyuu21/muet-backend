// js/navbar.js

function loadNavbar() {
    // 1. The unified HTML for your navigation bar
    const navbarHTML = `
        <nav class="navbar">
            <a href="index.html" class="logo-container">
                <img src="images/logo.png" alt="MUET Hub Logo" class="nav-logo">
                <span class="logo-text">MUET Hub</span>
            </a>
            
            <div class="nav-links">
                <a href="index.html" id="link-index">🏠 Homepage</a>
                <a href="writing.html" id="link-writing">✍️ Writing Practice</a>
                <a href="reading.html" id="link-reading">📖 Reading Practice</a>
                <a href="resources.html" id="link-resources">📂 Notes & Resources</a>
                <a href="admin.html" id="link-admin">⚙️ Resource Upload</a>
            </div>
        </nav>
    `;

    // 2. Inject it into the page
    const placeholder = document.getElementById('nav-placeholder');
    if (placeholder) {
        placeholder.innerHTML = navbarHTML;
    }

    // 3. Highlight the active tab
    let currentPath = window.location.pathname.split("/").pop();
    
    if (currentPath === "") {
        currentPath = "index.html";
    }

    const activeLinkId = `link-${currentPath.replace('.html', '')}`;
    const activeLinkElement = document.getElementById(activeLinkId);
    
    if (activeLinkElement) {
        activeLinkElement.classList.add('active');
    }
}

// Run the function as soon as the file loads
loadNavbar();