// js/navbar.js

function loadNavbar() {
    const navbarHTML = `
        <nav class="navbar">
            <a href="index.html" class="logo-container">
                <img src="images/logo.png" alt="MUET Hub Logo" class="nav-logo">
                <span class="logo-text">MUET Hub</span>
            </a>
            
            <button class="menu-toggle" id="menu-toggle">
                <i class="fas fa-bars"></i>
            </button>

            <div class="nav-links" id="nav-links">
                <a href="index.html" id="link-index">🏠 Homepage</a>
                <a href="writing.html" id="link-writing">✍️ Writing Practice</a>
                <a href="reading.html" id="link-reading">📖 Reading Practice</a>
                <a href="resources.html" id="link-resources">📂 Notes & Resources</a>
                <a href="admin.html" id="link-admin">⚙️ Resource Upload</a>
            </div>
        </nav>
    `;

    const placeholder = document.getElementById('nav-placeholder');
    if (placeholder) {
        placeholder.innerHTML = navbarHTML;
    }

    // Toggle functionality for Mobile
    const menuToggle = document.getElementById('menu-toggle');
    const navLinks = document.getElementById('nav-links');

    menuToggle.addEventListener('click', () => {
        navLinks.classList.toggle('active');
        // Change icon from bars to X when open
        const icon = menuToggle.querySelector('i');
        icon.classList.toggle('fa-bars');
        icon.classList.toggle('fa-times');
    });

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