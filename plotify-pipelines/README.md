# North American Garden Plants Scraper

A comprehensive Python script that extracts plant data from multiple sources: Wikipedia's "List of garden plants in North America" and San Marcos Growers plant database. The scraper merges data from both sources, deduplicates entries, and extracts detailed metadata from individual plant pages.

## Features

- **Multi-source data extraction**: Scrapes from Wikipedia and San Marcos Growers
- **Intelligent deduplication**: Merges data from different sources based on scientific names
- **Detailed metadata extraction**: Scrapes individual plant detail pages for comprehensive information
- **Flexible source selection**: Choose to scrape from Wikipedia only, SMG only, or both sources
- **Structured JSON output**: Comprehensive plant data with source attribution
- **Respectful scraping**: Includes delays and proper headers to be respectful to websites
- **Successfully extracts 2,300+ unique plant species**

## Installation

1. Install the required dependencies:
```bash
pip install -r requirements.txt
```

## Usage

### Basic Usage
Run the script to extract plants from both sources and save as JSON:
```bash
python plant_scraper.py
```

### Source Selection
Choose which data sources to scrape:
```bash
# Wikipedia only
python plant_scraper.py --sources wikipedia

# San Marcos Growers only  
python plant_scraper.py --sources smg

# Both sources (default)
python plant_scraper.py --sources both
```

### Custom Output Filename
Specify a custom filename:
```bash
python plant_scraper.py --output my_plants
```

This will create `my_plants.json`.

## Output Format

### JSON Format
```json
[
  {
    "plant_id": "a9e6b4f0-3d7c-4a9b-8e1f-6a7b8c9d0e1f",
    "common_name": "white forsythia",
    "youtube_link": "https://www.youtube.com/results?search_query=Abeliophyllum",
    "wikipedia_link": "https://en.wikipedia.org/wiki/Abeliophyllum",
    "smg_link": "https://www.smgrowers.com/products/plants/plantdisplay.asp?strLetter=A&plant_id=1234",
    "source": "Wikipedia, San Marcos Growers",
    "meta_data": {
      "scientific_name": "Abeliophyllum",
      "family": "Unknown",
      "plant_type": "Unknown",
      "sun_exposure": "Unknown",
      "water_requirements": "Unknown",
      "soil_type": "Unknown",
      "flower_color": "Unknown",
      "native_habitat": "North America",
      "dimensions": {
        "height": "Unknown",
        "width": "Unknown"
      },
      "fertilization": "Unknown",
      "pruning": "Unknown",
      "usda_hardiness_zone": "Unknown",
      "blooming_season": "Unknown"
    }
  }
]
```


## Data Structure

Each plant entry contains:
- `plant_id`: Unique UUID identifier for the plant
- `common_name`: The common name of the plant (falls back to scientific name if no common name)
- `youtube_link`: YouTube search results link for the plant (e.g., https://www.youtube.com/results?search_query=Encelia)
- `wikipedia_link`: Direct Wikipedia page link for the plant
- `smg_link`: San Marcos Growers detail page link (if available)
- `source`: Data source(s) - "Wikipedia", "San Marcos Growers", or "Wikipedia, San Marcos Growers"
- `meta_data`: Nested object containing detailed plant information:
  - `scientific_name`: The scientific/botanical name of the plant
  - `family`: Plant family classification
  - `plant_type`: Type of plant (tree, shrub, herb, etc.)
  - `sun_exposure`: Sunlight requirements
  - `water_requirements`: Watering needs
  - `soil_type`: Preferred soil conditions
  - `flower_color`: Color of flowers
  - `native_habitat`: Natural growing environment
  - `dimensions`: Object with height and width measurements
  - `fertilization`: Fertilization requirements and recommendations
  - `pruning`: Pruning guidelines and timing
  - `usda_hardiness_zone`: USDA hardiness zone range
  - `blooming_season`: When the plant typically blooms

**Note**: Most metadata fields are initially set to "Unknown" and would need to be populated from external botanical databases or manual research.

## Command Line Options

- `--format {json}`: Output format (default: json)
- `--output OUTPUT`: Specify output filename prefix (default: north_american_plants)
- `--sources {wikipedia,smg,both}`: Data sources to scrape (default: both)
- `--help`: Show help message

## Requirements

- Python 3.6+
- requests
- beautifulsoup4
- lxml

## Notes

- The script uses respectful web scraping practices with appropriate User-Agent headers
- The scraper handles the complex list structure on the Wikipedia page by identifying large lists (50+ items)
- Common names are extracted from parenthetical text following scientific names
- The script provides progress information as it processes each list section
- Successfully extracts over 1,900 plant species from the Wikipedia page

## Example Output

When you run the script, you'll see output like:
```
Starting plant scraper...
Extracting plant data...
Processing list 2 with 280 items
  Found 278 plants in list 2
Processing list 4 with 150 items
  Found 150 plants in list 4
Processing list 6 with 337 items
  Found 337 plants in list 6
...
Total plants found: 1964
Saved 1964 plants to north_american_plants.json

Sample of extracted plants:
1. Abelia
2. Abeliophyllum (white forsythia)
3. Abelmoschus (okra)
4. Abies (fir)
5. Abroma
... and 1959 more plants
```
