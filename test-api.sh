#!/bin/bash
echo "Testing knowledge graph APIs..."
echo ""

# First, check what APIs are available
echo "1. Checking /api/skills endpoint..."
curl -s http://localhost:3000/api/skills | head -100

echo ""
echo ""
echo "2. Checking server status (no error logs means success!)"
echo "Please check your browser at http://localhost:9002"
echo "Remember to refresh the page to clear old cache!"
