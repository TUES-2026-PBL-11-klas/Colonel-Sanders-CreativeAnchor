async function uploadImage() {
    const file = document.getElementById('imageInput').files[0];
    const formData = new FormData();
    formData.append('image', file);

    const response = await fetch('http://localhost:5000/upload', {
        method: 'POST',
        body: formData  // Don't set Content-Type header — browser sets it with boundary
    });

    const result = await response.json();
    console.log(result);
    }