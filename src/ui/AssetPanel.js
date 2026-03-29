import * as THREE from 'three';

/**
 * AssetPanel — Manages sprite import, thumbnail grid, and drag-to-canvas.
 */
export class AssetPanel {
  constructor() {
    this.assets = []; // { name, texture, image, dataUrl }
    this.selectedAsset = null;
    this.selectedAssets = [];
    this.onAssetSelected = null; // callback(asset)
    this.onAssetDragStart = null;

    this.dropZone = document.getElementById('drop-zone');
    this.fileInput = document.getElementById('file-input');
    this.assetGrid = document.getElementById('asset-grid');

    this.slicerControls = document.getElementById('slicer-controls');
    this.slicerTargetName = document.getElementById('slicer-target-name');
    this.btnSlice = document.getElementById('btn-slice-asset');
    this.inputSliceW = document.getElementById('slicer-w');
    this.inputSliceH = document.getElementById('slicer-h');

    this._initDragDrop();
    this._initSlicer();
  }

  _initSlicer() {
    if (!this.btnSlice) return;

    this.btnSlice.addEventListener('click', () => {
      if (!this.selectedAsset) return;
      this._sliceAsset(this.selectedAsset);
    });
  }

  _initDragDrop() {
    // Click to browse
    this.dropZone.addEventListener('click', () => this.fileInput.click());

    this.fileInput.addEventListener('change', (e) => {
      this._handleFiles(e.target.files);
      this.fileInput.value = '';
    });

    // Drag & drop
    this.dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.dropZone.classList.add('drag-over');
    });

    this.dropZone.addEventListener('dragleave', () => {
      this.dropZone.classList.remove('drag-over');
    });

    this.dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      this.dropZone.classList.remove('drag-over');
      const files = [...e.dataTransfer.files].filter(f => f.type === 'image/png');
      this._handleFiles(files);
    });
  }

  _handleFiles(files) {
    for (const file of files) {
      if (file.type !== 'image/png') continue;

      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target.result;
        const img = new Image();
        img.onload = () => {
          const texture = new THREE.Texture(img);
          texture.needsUpdate = true;
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.magFilter = THREE.NearestFilter;
          texture.minFilter = THREE.NearestMipMapLinearFilter;

          const name = file.name.replace('.png', '');
          const asset = { name, texture, image: img, dataUrl };
          this.assets.push(asset);
          this._addThumbnail(asset);
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    }
  }

  _addThumbnail(asset) {
    const thumb = document.createElement('div');
    thumb.classList.add('asset-thumb');
    thumb.title = asset.name;
    thumb.draggable = true;

    const img = document.createElement('img');
    img.src = asset.dataUrl;
    thumb.appendChild(img);

    const nameEl = document.createElement('div');
    nameEl.classList.add('asset-name');
    nameEl.textContent = asset.name;
    thumb.appendChild(nameEl);

    // Click to select
    thumb.addEventListener('click', (e) => {
      if (e.ctrlKey || e.metaKey || e.shiftKey) {
        if (thumb.classList.contains('selected')) {
          thumb.classList.remove('selected');
          this.selectedAssets = this.selectedAssets.filter(a => a !== asset);
        } else {
          thumb.classList.add('selected');
          if (!this.selectedAssets.includes(asset)) {
            this.selectedAssets.push(asset);
          }
        }
      } else {
        this.assetGrid.querySelectorAll('.asset-thumb').forEach(t =>
          t.classList.remove('selected')
        );
        thumb.classList.add('selected');
        this.selectedAssets = [asset];
        
        if (this.slicerControls) {
          this.slicerControls.style.display = 'block';
          this.slicerTargetName.textContent = asset.name;
        }
      }

      this.selectedAsset = this.selectedAssets[this.selectedAssets.length - 1] || null;

      if (this.onAssetSelected && this.selectedAsset) {
        this.onAssetSelected(this.selectedAsset);
      }
    });

    // Drag start for canvas placement
    thumb.addEventListener('dragstart', (e) => {
      const idx = this.assets.indexOf(asset);
      e.dataTransfer.setData('text/plain', idx.toString());
      e.dataTransfer.effectAllowed = 'copy';
      if (this.onAssetDragStart) this.onAssetDragStart(asset);
    });

    this.assetGrid.appendChild(thumb);
  }

  getAssetByIndex(idx) {
    return this.assets[idx] || null;
  }

  clearSelection() {
    this.selectedAsset = null;
    this.selectedAssets = [];
    this.assetGrid.querySelectorAll('.asset-thumb').forEach(t =>
      t.classList.remove('selected')
    );
    if (this.slicerControls) {
      this.slicerControls.style.display = 'none';
    }
  }

  _sliceAsset(asset) {
    const tileW = parseInt(this.inputSliceW.value, 10);
    const tileH = parseInt(this.inputSliceH.value, 10);

    if (isNaN(tileW) || isNaN(tileH) || tileW <= 0 || tileH <= 0) {
      alert('Invalid dimensions for slicing.');
      return;
    }

    const img = asset.image;
    const cols = Math.floor(img.width / tileW);
    const rows = Math.floor(img.height / tileH);
    
    if (cols === 0 || rows === 0) {
      alert('Tile dimension is larger than the image.');
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = tileW;
    canvas.height = tileH;
    const ctx = canvas.getContext('2d');
    
    // Nearest neighbor sampling for crispy pixels
    ctx.imageSmoothingEnabled = false;

    let slicedCount = 0;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        ctx.clearRect(0, 0, tileW, tileH);
        
        // Exract region from image
        // drawImage(image, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight)
        ctx.drawImage(img, c * tileW, r * tileH, tileW, tileH, 0, 0, tileW, tileH);
        
        // Check if slice is empty (all transparent)
        const frameData = ctx.getImageData(0, 0, tileW, tileH).data;
        let isEmpty = true;
        for (let i = 3; i < frameData.length; i += 4) {
          if (frameData[i] > 10) { // Has non-transparent pixel
            isEmpty = false;
            break;
          }
        }
        
        if (!isEmpty) {
          const dataUrl = canvas.toDataURL('image/png');
          const sliceName = `${asset.name}_${r}_${c}`;
          
          const newImg = new Image();
          newImg.onload = () => {
            const texture = new THREE.Texture(newImg);
            texture.needsUpdate = true;
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.magFilter = THREE.NearestFilter;
            texture.minFilter = THREE.NearestMipMapLinearFilter;

            const newAsset = { name: sliceName, texture, image: newImg, dataUrl };
            this.assets.push(newAsset);
            this._addThumbnail(newAsset);
          };
          newImg.src = dataUrl;
          slicedCount++;
        }
      }
    }
    
    // Fire a hypothetical toast or global event if we had one injected, 
    // but we can just use console or alert if no global toast available
    if (window.showToast) {
       window.showToast(`Sliced ${slicedCount} tiles from ${asset.name}`);
    } else {
       console.log(`Sliced ${slicedCount} tiles from ${asset.name}`);
    }
  }
}
