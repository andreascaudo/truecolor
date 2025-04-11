"use strict";

const videoElement = document.getElementById('video-input');
const imageElement = document.getElementById('image-input');
const canvasElement = document.getElementById('output-canvas');
const ctx = canvasElement.getContext('2d', { willReadFrequently: true }); // Optimize for frequent reads
const toggleViewBtn = document.getElementById('toggle-view-btn');
const uploadImageInput = document.getElementById('upload-image');
const startCameraBtn = document.getElementById('start-camera-btn');
const flipCameraBtn = document.getElementById('flip-camera-btn');
const mediaContainer = document.querySelector('.media-container');
const placeholderElement = document.querySelector('.placeholder');
const bodyElement = document.body;

let isShowingAbsorbed = false;
let currentSource = null; // 'video' or 'image'
let animationFrameId = null;
let sourceWidth = 640;
let sourceHeight = 480;
let isFrontCamera = true; // Default to front camera
let currentStream = null; // Store the current stream to stop it when switching cameras

// --- Core Processing Logic ---

function processFrame() {
    if (!currentSource) return;

    // On mobile, we need to make sure the canvas covers the entire container
    const isMobile = window.innerWidth <= 768;

    // Set canvas dimensions to match the container, not just the source
    canvasElement.width = mediaContainer.clientWidth;
    canvasElement.height = mediaContainer.clientHeight;

    // Clear the canvas first
    ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);

    // 1. Draw source to canvas (used for getting pixels)
    let sourceToDraw = null;
    if (currentSource === 'video' && videoElement.readyState >= videoElement.HAVE_CURRENT_DATA) {
        sourceToDraw = videoElement;
    } else if (currentSource === 'image' && imageElement.complete && imageElement.naturalWidth > 0) {
        sourceToDraw = imageElement;
    }

    if (!sourceToDraw) {
        // Source not ready yet, try again
        animationFrameId = requestAnimationFrame(processFrame);
        return;
    }

    // Handle different object-fit styles
    if (isMobile && currentSource === 'video') {
        // For mobile with object-fit: cover, we need to calculate dimensions
        // to properly center and fill the canvas
        const vidRatio = sourceToDraw.videoWidth / sourceToDraw.videoHeight;
        const containerRatio = canvasElement.width / canvasElement.height;

        let drawWidth, drawHeight, offsetX = 0, offsetY = 0;

        if (vidRatio > containerRatio) {
            // Video is wider than container: match heights and center horizontally
            drawHeight = canvasElement.height;
            drawWidth = drawHeight * vidRatio;
            offsetX = (canvasElement.width - drawWidth) / 2;
        } else {
            // Video is taller than container: match widths and center vertically
            drawWidth = canvasElement.width;
            drawHeight = drawWidth / vidRatio;
            offsetY = (canvasElement.height - drawHeight) / 2;
        }

        // Draw source onto the canvas to fill it
        ctx.drawImage(sourceToDraw, offsetX, offsetY, drawWidth, drawHeight);
    } else {
        // Standard drawing for desktop or images
        ctx.drawImage(sourceToDraw, 0, 0, canvasElement.width, canvasElement.height);
    }

    // 2. Get Pixel Data
    try {
        const imageData = ctx.getImageData(0, 0, canvasElement.width, canvasElement.height);
        const data = imageData.data; // Array of [R, G, B, A, R, G, B, A, ...]

        // 3. Apply Transformation (Invert RGB)
        for (let i = 0; i < data.length; i += 4) {
            data[i] = 255 - data[i];     // Red
            data[i + 1] = 255 - data[i + 1]; // Green
            data[i + 2] = 255 - data[i + 2]; // Blue
            // data[i + 3] is Alpha - leave it unchanged
        }

        // 4. Put Modified Data Back
        ctx.putImageData(imageData, 0, 0);

    } catch (e) {
        console.error("Error processing frame:", e);
        // Ignore CORS errors for local testing with file uploads, etc.
        if (e.name === 'SecurityError') {
            console.warn("Canvas processing failed due to security restrictions (e.g., CORS). Ensure images/videos are served correctly or disable security for local testing.");
        }
    }

    // Continue the loop only if video is the source
    if (currentSource === 'video') {
        animationFrameId = requestAnimationFrame(processFrame);
    }
}


// --- UI and Source Handling ---

function setView(showAbsorbed) {
    isShowingAbsorbed = showAbsorbed;
    bodyElement.classList.toggle('show-absorbed', isShowingAbsorbed);

    // Update icon based on state
    if (isShowingAbsorbed) {
        toggleViewBtn.innerHTML = '<i class="fas fa-eye-slash"></i>';
        toggleViewBtn.setAttribute('aria-label', 'Show Original Colors');
    } else {
        toggleViewBtn.innerHTML = '<i class="fas fa-eye"></i>';
        toggleViewBtn.setAttribute('aria-label', 'Show Absorbed Colors');
    }

    if (isShowingAbsorbed && currentSource) {
        // Start processing if switching to absorbed view
        if (animationFrameId === null) {
            processFrame(); // Start the loop or process the static image
        }
    } else {
        // Stop processing if switching back to original view
        if (animationFrameId !== null) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
        // Ensure correct source element is visible
        updateSourceVisibility();
    }

    // Update placeholder visibility
    updatePlaceholderVisibility();
}

function updatePlaceholderVisibility() {
    if (currentSource) {
        placeholderElement.style.display = 'none';
    } else {
        placeholderElement.style.display = 'flex';
    }
}

function updateSourceVisibility() {
    videoElement.style.display = 'none';
    imageElement.style.display = 'none';
    videoElement.classList.remove('active-source');
    imageElement.classList.remove('active-source');

    if (!isShowingAbsorbed) {
        if (currentSource === 'video') {
            videoElement.style.display = 'block';
            videoElement.classList.add('active-source');
        } else if (currentSource === 'image') {
            imageElement.style.display = 'block';
            imageElement.classList.add('active-source');
        }
    }
    // The canvas visibility is handled by the .show-absorbed class in CSS

    // Update camera controls
    updateCameraControls();
}

// Stop any active camera stream
function stopCamera() {
    if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
        currentStream = null;
    }
    if (videoElement.srcObject) {
        videoElement.srcObject = null;
    }
}

async function startCamera() {
    console.log("Attempting to start camera...");
    startCameraBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    startCameraBtn.disabled = true;
    flipCameraBtn.disabled = true;

    if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }

    // Stop any existing camera stream
    stopCamera();

    currentSource = 'video';
    imageElement.style.display = 'none'; // Hide image if it was visible
    imageElement.src = '#'; // Clear image source
    videoElement.style.display = 'block'; // Show video element

    try {
        const facingMode = isFrontCamera ? "user" : "environment";
        console.log(`Using camera with facing mode: ${facingMode}`);

        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: facingMode,
                width: { ideal: 640 },
                height: { ideal: 480 }
            },
            audio: false
        });

        currentStream = stream;
        videoElement.srcObject = stream;
        videoElement.onloadedmetadata = () => {
            sourceWidth = videoElement.videoWidth;
            sourceHeight = videoElement.videoHeight;
            console.log(`Camera started: ${sourceWidth}x${sourceHeight}`);

            // For desktop, set container size based on video dimensions
            if (window.innerWidth > 768) {
                mediaContainer.style.width = `${sourceWidth}px`;
                mediaContainer.style.height = `${sourceHeight}px`;
            }
            // For mobile, we let CSS handle the container size

            updateSourceVisibility(); // Make sure video is shown if needed
            // Start processing only if absorbed view is active
            if (isShowingAbsorbed) {
                processFrame();
            } else {
                // Ensure video feed is visible
                updateSourceVisibility();
            }
            updatePlaceholderVisibility();
            updateCameraControls();

            // Update button to show stop icon
            startCameraBtn.innerHTML = '<i class="fas fa-stop"></i>';
            startCameraBtn.setAttribute('aria-label', 'Stop Camera');
            startCameraBtn.disabled = false;
            flipCameraBtn.disabled = false;
        };
    } catch (err) {
        console.error("Error accessing camera:", err);
        alert("Could not access the camera. Please ensure permission is granted and no other application is using it.");
        currentSource = null;
        videoElement.style.display = 'none';
        updatePlaceholderVisibility();
        updateCameraControls();

        // Reset button state
        startCameraBtn.innerHTML = '<i class="fas fa-camera"></i>';
        startCameraBtn.setAttribute('aria-label', 'Start Camera');
        startCameraBtn.disabled = false;
        flipCameraBtn.disabled = false;
    }
}

function toggleCamera() {
    isFrontCamera = !isFrontCamera;

    // Only restart the camera if it's currently the active source
    if (currentSource === 'video') {
        startCamera();
    }
}

function handleImageUpload(event) {
    const file = event.target.files[0];
    if (file) {
        if (animationFrameId !== null) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }

        // Stop any active camera
        stopCamera();

        currentSource = 'image';
        videoElement.style.display = 'none'; // Hide video if it was visible

        // Show loading indicator
        placeholderElement.innerHTML = '<i class="fas fa-spinner fa-spin"></i><p>Loading image...</p>';
        placeholderElement.style.display = 'flex';

        const reader = new FileReader();
        reader.onload = (e) => {
            imageElement.onload = () => {
                sourceWidth = imageElement.naturalWidth;
                sourceHeight = imageElement.naturalHeight;
                console.log(`Image loaded: ${sourceWidth}x${sourceHeight}`);
                // Reset container size
                mediaContainer.style.width = `${sourceWidth}px`;
                mediaContainer.style.height = `${sourceHeight}px`;
                updateSourceVisibility(); // Make sure image is shown if needed
                // Process the static image immediately if in absorbed view
                if (isShowingAbsorbed) {
                    processFrame();
                } else {
                    // Ensure image is visible
                    updateSourceVisibility();
                }
                updatePlaceholderVisibility();
                updateCameraControls();

                // Reset placeholder content
                placeholderElement.innerHTML = '<i class="fas fa-camera-retro"></i><p>Start camera or upload an image</p>';
            };
            imageElement.src = e.target.result;
            imageElement.style.display = 'block'; // Show image element
        }
        reader.readAsDataURL(file);
    }
}

// Show/hide flip camera button based on camera state
function updateCameraControls() {
    if (currentSource === 'video') {
        flipCameraBtn.style.display = 'flex';
    } else {
        flipCameraBtn.style.display = 'none';
    }
}

// --- Event Listeners ---

toggleViewBtn.addEventListener('click', () => {
    setView(!isShowingAbsorbed);
});

// Change startCameraBtn to toggle camera on/off
startCameraBtn.addEventListener('click', () => {
    if (currentSource === 'video' && currentStream) {
        // Camera is active, stop it
        stopCameraAndResetUI();
    } else {
        // Camera is not active, start it
        startCamera();
    }
});

flipCameraBtn.addEventListener('click', toggleCamera);

uploadImageInput.addEventListener('change', handleImageUpload);

// Function to stop camera and reset UI
function stopCameraAndResetUI() {
    if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }

    // Stop the camera stream
    stopCamera();

    // Reset UI
    currentSource = null;
    videoElement.style.display = 'none';
    videoElement.classList.remove('active-source');

    // Update button appearance
    startCameraBtn.innerHTML = '<i class="fas fa-camera"></i>';
    startCameraBtn.setAttribute('aria-label', 'Start Camera');

    // Hide flip camera button
    flipCameraBtn.style.display = 'none';

    // Show placeholder
    updatePlaceholderVisibility();
}

// --- Initial Setup ---
// Optionally start with camera or leave blank until user interaction
console.log("TrueColor script loaded. Ready for input.");
// Ensure initial view state is correct (hide canvas)
setView(false);
// Show placeholder initially
updatePlaceholderVisibility();
// Hide flip button initially
flipCameraBtn.style.display = 'none'; 