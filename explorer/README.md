# Anatomy of Bitcoin Explorer

A 3D interactive Bitcoin protocol explorer built with vanilla HTML, CSS, and JavaScript using Three.js.

## Features

- **Multi-page Architecture**: Network, Node, Blockchain, Difficulty, Block, Transaction, and Mempool pages
- **3D Visualizations**: Interactive 3D scenes for each aspect of Bitcoin
- **Real-time Data**: Fetches live data from Bitcoin APIs (Mempool.space, Bitnodes.io, pvxg.net)
- **Mobile Responsive**: Hamburger menu and responsive design
- **Consistent UI**: Black and white theme with professional styling

## Pages

### Network
- 3D globe visualization of Bitcoin nodes worldwide
- Real-time node data from Bitnodes.io
- Filter by node implementations (Bitcoin Core, Knots, bcoin, etc.)
- Interactive node selection and navigation

### Node
- Detailed view of individual Bitcoin nodes
- 3D visualization of Bitcoin protocol features
- Real-time node status and information
- Feature tooltips with links to BIP documentation

### Blockchain
- Helix visualization of Bitcoin difficulty adjustments
- Interactive discs representing 2016-block epochs
- Double-click navigation to difficulty adjustments
- UTXO visualization toggle

### Difficulty
- Spiral visualization of blocks within difficulty epochs
- Time-based spacing using real blockchain data
- Interactive block selection with tooltips
- Navigation to individual blocks

### Block
- Individual block details and visualization
- Real-time block data from Mempool.space
- Transaction information and statistics

### Transaction
- Transaction details and visualization
- Input/output analysis
- Fee and confirmation information

### Mempool
- Real-time mempool visualization
- Transaction queue with fee-based ordering
- Spiral layout with fade-out effect
- Live transaction count updates

## Data Sources

- **Mempool.space**: Block and transaction data
- **Bitnodes.io**: Network node information
- **pvxg.net**: Difficulty epoch data

## Technologies

- **Three.js**: 3D graphics and visualization
- **Vanilla JavaScript**: No frameworks or build tools
- **HTML5/CSS3**: Modern web standards
- **Web APIs**: Fetch API for data retrieval

## Getting Started

1. Open `index.html` in a modern web browser
2. Navigate between pages using the top navigation
3. Interact with 3D scenes using mouse controls:
   - **Drag**: Rotate camera
   - **Shift + Drag**: Pan camera
   - **Scroll**: Zoom in/out
   - **Double-click**: Navigate to detailed views

## Browser Compatibility

- Chrome/Chromium (recommended)
- Firefox
- Safari
- Edge

## License

MIT License - see LICENSE file for details.

## Contributing

This project is part of the Bitcoin Anatomy initiative. Contributions are welcome! 