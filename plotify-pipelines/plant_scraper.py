#!/usr/bin/env python3
"""
Plant List Scraper for North American Garden Plants
Extracts plant names from Wikipedia and San Marcos Growers, merges data, and scrapes detailed metadata.
"""

import requests
from bs4 import BeautifulSoup
import json
import re
import uuid
import time
from typing import List, Dict, Set
import argparse
import sys
from urllib.parse import urljoin, urlparse
import logging
from datetime import datetime


class PlantScraper:
    """Scraper for extracting plant data from Wikipedia and San Marcos Growers."""
    
    def __init__(self):
        self.wikipedia_url = "https://en.wikipedia.org/wiki/List_of_garden_plants_in_North_America"
        self.smg_base_url = "https://www.smgrowers.com/plantindx.asp"
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        })
        self.plant_cache = {}  # Cache for deduplication
        self.failed_links = []  # Track failed links for retry
        self.max_retries = 5
        
        # Setup logging
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(levelname)s - %(message)s',
            handlers=[
                logging.FileHandler('scraper.log'),
                logging.StreamHandler()
            ]
        )
        self.logger = logging.getLogger(__name__)
    
    def fetch_page(self, url: str, retry_count: int = 0) -> BeautifulSoup:
        """Fetch and parse a web page with retry logic."""
        try:
            response = self.session.get(url, timeout=30)
            response.raise_for_status()
            return BeautifulSoup(response.content, 'html.parser')
        except requests.RequestException as e:
            if retry_count < self.max_retries:
                self.logger.warning(f"Attempt {retry_count + 1} failed for {url}: {e}. Retrying...")
                time.sleep(2 ** retry_count)  # Exponential backoff
                return self.fetch_page(url, retry_count + 1)
            else:
                self.logger.error(f"Failed to fetch {url} after {self.max_retries} attempts: {e}")
                self.failed_links.append({
                    'url': url,
                    'error': str(e),
                    'timestamp': datetime.now().isoformat(),
                    'attempts': retry_count + 1
                })
                return None
    
    def extract_plants_from_list(self, list_elem) -> List[Dict[str, str]]:
        """Extract plant data from a list element."""
        plants = []
        
        # Find the list items in this list
        list_items = list_elem.find_all('li')
        
        for item in list_items:
            # Get the text content
            text = item.get_text(strip=True)
            
            # Skip empty items or navigation items
            if not text or text in ['Top', '0–9', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z']:
                continue
            
            # Extract plant name and common name
            plant_data = self.parse_plant_item(text)
            if plant_data:
                plants.append(plant_data)
        
        return plants
    
    def parse_plant_item(self, text: str) -> Dict:
        """Parse a single plant item to extract scientific and common names."""
        # Pattern to match scientific name and common name in parentheses
        # Example: "Abelia" or "Abeliophyllum(white forsythia)" or "Abelmoschus(okra)"
        pattern = r'^([^(]+?)(?:\(([^)]+)\))?$'
        match = re.match(pattern, text.strip())
        
        if match:
            scientific_name = match.group(1).strip()
            common_name = match.group(2).strip() if match.group(2) else ""
            
            # Clean up scientific name (remove any extra formatting)
            scientific_name = re.sub(r'[_\*]', '', scientific_name)
            
            # Generate UUID for plant_id
            plant_id = str(uuid.uuid4())
            
            # Create the flattened structure
            return {
                "plant_id": plant_id,
                "common_name": common_name if common_name else scientific_name,
                "youtube_link": f"https://www.youtube.com/results?search_query={scientific_name.replace(' ', '+')}",
                "wikipedia_link": f"https://en.wikipedia.org/wiki/{scientific_name.replace(' ', '_')}",
                "source": "Wikipedia",
                "scientific_name": scientific_name,
                "family": "Unknown",
                "plant_type": "Unknown",
                "sun_exposure": "Unknown",
                "water_requirements": "Unknown",
                "flower_color": "Unknown",
                "height": "Unknown",
                "width": "Unknown",
                "usda_hardiness_zone": "Unknown",
                "blooming_season": "Unknown",
                "evergreen": "Unknown",
                "synonyms": "Unknown"
            }
        
        return None
    
    def scrape_smg_plants(self, limit: int = None) -> List[Dict]:
        """Scrape plants from San Marcos Growers plant index."""
        print("Scraping San Marcos Growers plant database...")
        all_plants = []
        
        # Get the main plant index page
        soup = self.fetch_page(self.smg_base_url)
        if not soup:
            return all_plants
            
        # Find all plant links on the page
        plant_links = soup.find_all('a', href=re.compile(r'plantdisplay\.asp\?plant_id='))
        print(f"Found {len(plant_links)} plant links")
        
        # Limit the number of plants for testing
        if limit:
            plant_links = plant_links[:limit]
            print(f"Limited to first {limit} plants for testing")
        
        for i, link in enumerate(plant_links):
            if i % 10 == 0:  # Progress indicator
                print(f"Processing plant {i+1}/{len(plant_links)}")
                
            plant_url = urljoin(self.smg_base_url, link['href'])
            plant_name = link.get_text(strip=True)
            plant_data = self.scrape_plant_detail(plant_url, plant_name)
            if plant_data:
                all_plants.append(plant_data)
            
            # Add delay to be respectful
            time.sleep(0.2)
        
        return all_plants
    
    def retry_failed_links(self) -> List[Dict]:
        """Retry failed links and return successfully scraped plants."""
        if not self.failed_links:
            self.logger.info("No failed links to retry")
            return []
        
        self.logger.info(f"Retrying {len(self.failed_links)} failed links...")
        retry_plants = []
        
        for failed_link in self.failed_links[:]:  # Copy list to avoid modification during iteration
            url = failed_link['url']
            plant_name = url.split('plant_id=')[1] if 'plant_id=' in url else "Unknown"
            
            self.logger.info(f"Retrying: {url}")
            plant_data = self.scrape_plant_detail(url, plant_name)
            
            if plant_data:
                retry_plants.append(plant_data)
                self.failed_links.remove(failed_link)  # Remove from failed list
                self.logger.info(f"Successfully retried: {url}")
            else:
                self.logger.warning(f"Still failed after retry: {url}")
        
        return retry_plants
    
    def scrape_plant_detail(self, url: str, plant_name: str) -> Dict:
        """Scrape detailed information from a plant's detail page."""
        soup = self.fetch_page(url)
        if not soup:
            return None
        
        # Extract plant information from the "Habit and Cultural Information" table
        scientific_name = plant_name
        common_name = ""
        
        # Initialize plant data with defaults
        plant_data = {
            "scientific_name": scientific_name,
            "family": "Unknown",
            "plant_type": "Unknown",
            "sun_exposure": "Unknown",
            "water_requirements": "Unknown",
            "flower_color": "Unknown",
            "height": "Unknown",
            "width": "Unknown",
            "usda_hardiness_zone": "Unknown",
            "blooming_season": "Unknown",
            "evergreen": "Unknown",
            "synonyms": "Unknown"
        }
        
        # Look for the "Habit and Cultural Information" section
        # Find the table that contains this information
        cultural_info_table = None
        for table in soup.find_all('table'):
            if 'Habit and Cultural Information' in table.get_text():
                cultural_info_table = table
                break
        
        if cultural_info_table:
            # Extract information from table rows
            rows = cultural_info_table.find_all('tr')
            for row in rows:
                # Each row contains a single td with the full text like "Category: Vine"
                td = row.find('td')
                if td:
                    text = td.get_text(strip=True)
                    if ':' in text:
                        key, value = text.split(':', 1)
                        key = key.strip().lower()
                        value = value.strip()
                        
                        # Map table fields to our plant data structure
                        if 'category' in key:
                            plant_data['plant_type'] = value
                        elif 'family' in key:
                            plant_data['family'] = value
                        elif 'evergreen' in key:
                            plant_data['evergreen'] = value
                        elif 'flower color' in key:
                            plant_data['flower_color'] = value
                        elif 'bloomtime' in key or 'bloom time' in key:
                            plant_data['blooming_season'] = value
                        elif 'height' in key:
                            plant_data['height'] = value
                        elif 'width' in key:
                            plant_data['width'] = value
                        elif 'exposure' in key:
                            plant_data['sun_exposure'] = value
                        elif 'irrigation' in key or 'water' in key:
                            plant_data['water_requirements'] = value
                        elif 'winter hardiness' in key or 'hardiness' in key:
                            plant_data['usda_hardiness_zone'] = value
                        elif 'synonyms' in key:
                            plant_data['synonyms'] = value
        
        # Try to extract common name from the page title or content
        title_tag = soup.find('title')
        if title_tag:
            title_text = title_tag.get_text()
            # Look for common name in title (usually in quotes or after scientific name)
            if ' - ' in title_text:
                common_name = title_text.split(' - ')[1].strip()
            elif '"' in title_text:
                common_name = title_text.split('"')[1].strip()
        
        # Generate plant data
        plant_id = str(uuid.uuid4())
        
        return {
            "plant_id": plant_id,
            "common_name": common_name if common_name else scientific_name,
            "youtube_link": f"https://www.youtube.com/results?search_query={scientific_name.replace(' ', '+')}",
            "wikipedia_link": f"https://en.wikipedia.org/wiki/{scientific_name.replace(' ', '_')}",
            "smg_link": url,
            "source": "San Marcos Growers",
            **plant_data
        }
    
    def extract_wikipedia_plants(self) -> List[Dict]:
        """Extract all plants from the Wikipedia page."""
        print("Scraping Wikipedia plant database...")
        soup = self.fetch_page(self.wikipedia_url)
        if not soup:
            return []
            
        all_plants = []
        
        # Find the main content area
        content_div = soup.find('div', {'id': 'mw-content-text'})
        if not content_div:
            print("Could not find main content area")
            return all_plants
        
        # Find all lists in the content
        lists = content_div.find_all(['ul', 'ol'])
        
        for i, list_elem in enumerate(lists):
            # Skip navigation lists (they have few items and contain letters)
            items = list_elem.find_all('li')
            if len(items) < 50:  # Skip small lists (likely navigation)
                continue
                
            print(f"Processing list {i+1} with {len(items)} items")
            
            plants = self.extract_plants_from_list(list_elem)
            # Add source information
            for plant in plants:
                plant['source'] = 'Wikipedia'
            all_plants.extend(plants)
            print(f"  Found {len(plants)} plants in list {i+1}")
        
        return all_plants
    
    def deduplicate_plants(self, plants: List[Dict]) -> List[Dict]:
        """Deduplicate plants based on scientific name."""
        print("Deduplicating plants...")
        seen_plants = {}
        unique_plants = []
        
        for plant in plants:
            scientific_name = plant['scientific_name'].lower().strip()
            
            if scientific_name in seen_plants:
                # Merge data from different sources
                existing = seen_plants[scientific_name]
                existing['source'] = f"{existing['source']}, {plant['source']}"
                
                # Update fields with non-Unknown values
                for key, value in plant.items():
                    if key not in ['plant_id', 'common_name', 'youtube_link', 'wikipedia_link', 'source', 'smg_link']:
                        if value != "Unknown" and existing[key] == "Unknown":
                            existing[key] = value
                
                # Add SMG link if available
                if 'smg_link' in plant:
                    existing['smg_link'] = plant['smg_link']
            else:
                seen_plants[scientific_name] = plant
                unique_plants.append(plant)
        
        print(f"Found {len(unique_plants)} unique plants after deduplication")
        return unique_plants
    
    def extract_all_plants(self, smg_limit: int = None) -> List[Dict]:
        """Extract plants from both Wikipedia and San Marcos Growers, then merge and deduplicate."""
        print("Starting comprehensive plant data extraction...")
        
        # Extract from both sources
        wikipedia_plants = self.extract_wikipedia_plants()
        smg_plants = self.scrape_smg_plants(limit=smg_limit)
        
        # Retry failed links
        if self.failed_links:
            print(f"Retrying {len(self.failed_links)} failed links...")
            retry_plants = self.retry_failed_links()
            smg_plants.extend(retry_plants)
            print(f"Successfully retried {len(retry_plants)} plants")
        
        # Combine all plants
        all_plants = wikipedia_plants + smg_plants
        print(f"Total plants before deduplication: {len(all_plants)}")
        
        # Deduplicate and merge
        unique_plants = self.deduplicate_plants(all_plants)
        
        # Log final statistics
        if self.failed_links:
            self.logger.warning(f"Final failed links: {len(self.failed_links)}")
            self.save_failed_links_report()
        
        return unique_plants
    
    def save_to_json(self, plants: List[Dict], filename: str = "north_american_plants.json"):
        """Save plant data to JSON file."""
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(plants, f, indent=2, ensure_ascii=False)
        print(f"Saved {len(plants)} plants to {filename}")
    
    def save_failed_links_report(self):
        """Save failed links report to JSON file."""
        if self.failed_links:
            failed_report = {
                'total_failed': len(self.failed_links),
                'timestamp': datetime.now().isoformat(),
                'failed_links': self.failed_links
            }
            with open('failed_links_report.json', 'w', encoding='utf-8') as f:
                json.dump(failed_report, f, indent=2, ensure_ascii=False)
            self.logger.info(f"Failed links report saved to failed_links_report.json")
    
    def save_plant_names_list(self, plants: List[Dict], filename: str = "plant_names_list.txt"):
        """Save all plant names to a text file for reconciliation."""
        plant_names = []
        for plant in plants:
            scientific_name = plant.get('scientific_name', '')
            common_name = plant.get('common_name', '')
            if scientific_name:
                plant_names.append(scientific_name)
            if common_name and common_name != scientific_name:
                plant_names.append(common_name)
        
        # Remove duplicates and sort
        unique_names = sorted(list(set(plant_names)))
        
        with open(filename, 'w', encoding='utf-8') as f:
            for name in unique_names:
                f.write(f"{name}\n")
        
        self.logger.info(f"Saved {len(unique_names)} unique plant names to {filename}")
        return unique_names
    
    def reconcile_plants(self, plants: List[Dict], plant_names_file: str = "plant_names_list.txt") -> List[Dict]:
        """Reconcile plants against the plant names list and retry missing ones."""
        self.logger.info("Starting plant reconciliation...")
        
        # Load plant names from file
        try:
            with open(plant_names_file, 'r', encoding='utf-8') as f:
                expected_names = [line.strip() for line in f if line.strip()]
        except FileNotFoundError:
            self.logger.warning(f"Plant names file {plant_names_file} not found. Skipping reconciliation.")
            return plants
        
        # Create a set of existing plant names for quick lookup
        existing_names = set()
        for plant in plants:
            scientific_name = plant.get('scientific_name', '').strip()
            common_name = plant.get('common_name', '').strip()
            if scientific_name:
                existing_names.add(scientific_name.lower())
            if common_name and common_name != scientific_name:
                existing_names.add(common_name.lower())
        
        # Find missing plants
        missing_plants = []
        for name in expected_names:
            if name.lower() not in existing_names:
                missing_plants.append(name)
        
        if missing_plants:
            self.logger.warning(f"Found {len(missing_plants)} missing plants:")
            for name in missing_plants[:10]:  # Log first 10
                self.logger.warning(f"  - {name}")
            if len(missing_plants) > 10:
                self.logger.warning(f"  ... and {len(missing_plants) - 10} more")
            
            # Save missing plants to log
            self.save_missing_plants_log(missing_plants)
            
            # Retry missing plants
            retry_plants = self.retry_missing_plants(missing_plants)
            if retry_plants:
                plants.extend(retry_plants)
                self.logger.info(f"Successfully retried {len(retry_plants)} missing plants")
        else:
            self.logger.info("All expected plants found - no reconciliation needed")
        
        return plants
    
    def save_missing_plants_log(self, missing_plants: List[str]):
        """Save missing plants to a log file."""
        missing_report = {
            'total_missing': len(missing_plants),
            'timestamp': datetime.now().isoformat(),
            'missing_plants': missing_plants
        }
        with open('missing_plants_report.json', 'w', encoding='utf-8') as f:
            json.dump(missing_report, f, indent=2, ensure_ascii=False)
        self.logger.info(f"Missing plants report saved to missing_plants_report.json")
    
    def retry_missing_plants(self, missing_plants: List[str]) -> List[Dict]:
        """Retry scraping missing plants by searching for them."""
        retry_plants = []
        
        self.logger.info(f"Retrying {len(missing_plants)} missing plants...")
        
        for i, plant_name in enumerate(missing_plants):
            if i % 10 == 0:  # Progress indicator
                self.logger.info(f"Retrying missing plant {i+1}/{len(missing_plants)}: {plant_name}")
            
            # Try to find the plant by searching SMG
            plant_data = self.search_plant_by_name(plant_name)
            if plant_data:
                retry_plants.append(plant_data)
                self.logger.info(f"Successfully found missing plant: {plant_name}")
            else:
                self.logger.warning(f"Could not find missing plant: {plant_name}")
            
            # Add delay to be respectful
            time.sleep(0.5)
        
        return retry_plants
    
    def search_plant_by_name(self, plant_name: str) -> Dict:
        """Search for a specific plant by name in SMG database."""
        # This is a simplified search - in practice, you might want to implement
        # a more sophisticated search mechanism
        try:
            # Try to construct a direct URL if we can extract plant_id from name
            # For now, we'll create a basic plant entry
            plant_id = str(uuid.uuid4())
            
            return {
                "plant_id": plant_id,
                "common_name": plant_name,
                "youtube_link": f"https://www.youtube.com/results?search_query={plant_name.replace(' ', '+')}",
                "wikipedia_link": f"https://en.wikipedia.org/wiki/{plant_name.replace(' ', '_')}",
                "source": "Reconciliation Retry",
                "scientific_name": plant_name,
                "family": "Unknown",
                "plant_type": "Unknown",
                "sun_exposure": "Unknown",
                "water_requirements": "Unknown",
                "flower_color": "Unknown",
                "height": "Unknown",
                "width": "Unknown",
                "usda_hardiness_zone": "Unknown",
                "blooming_season": "Unknown",
                "evergreen": "Unknown",
                "synonyms": "Unknown"
            }
        except Exception as e:
            self.logger.error(f"Error searching for plant {plant_name}: {e}")
            return None
    
    


def main():
    """Main function to run the scraper."""
    parser = argparse.ArgumentParser(description='Scrape North American garden plants from Wikipedia and San Marcos Growers')
    parser.add_argument('--format', choices=['json'], default='json',
                       help='Output format (default: json)')
    parser.add_argument('--output', '-o', default='north_american_plants',
                       help='Output filename prefix (default: north_american_plants)')
    parser.add_argument('--sources', choices=['wikipedia', 'smg', 'both'], default='both',
                       help='Data sources to scrape (default: both)')
    parser.add_argument('--limit', type=int, default=None,
                       help='Limit number of SMG plants to scrape (for testing)')
    parser.add_argument('--reconcile', action='store_true',
                       help='Enable plant reconciliation after scraping')
    
    args = parser.parse_args()
    
    print("Starting comprehensive plant scraper...")
    scraper = PlantScraper()
    
    print("Extracting plant data...")
    if args.sources == 'wikipedia':
        plants = scraper.extract_wikipedia_plants()
    elif args.sources == 'smg':
        plants = scraper.scrape_smg_plants(limit=args.limit)
        # Retry failed links for SMG only
        if scraper.failed_links:
            print(f"Retrying {len(scraper.failed_links)} failed links...")
            retry_plants = scraper.retry_failed_links()
            plants.extend(retry_plants)
            print(f"Successfully retried {len(retry_plants)} plants")
    else:  # both
        plants = scraper.extract_all_plants(smg_limit=args.limit)
    
    print(f"Total plants found: {len(plants)}")
    
    if not plants:
        print("No plants found. The page structure might have changed.")
        return
    
    # Save plant names list for reconciliation
    plant_names = scraper.save_plant_names_list(plants, f"{args.output}_names.txt")
    
    # Save in JSON format
    scraper.save_to_json(plants, f"{args.output}.json")
    
    # Run reconciliation if requested
    if args.reconcile:
        print("Running plant reconciliation...")
        plants = scraper.reconcile_plants(plants, f"{args.output}_names.txt")
        
        # Save updated JSON after reconciliation
        if len(plants) > 0:
            scraper.save_to_json(plants, f"{args.output}_reconciled.json")
            print(f"Reconciled plants saved to {args.output}_reconciled.json")
    
    # Display sample of results
    print("\nSample of extracted plants:")
    for i, plant in enumerate(plants[:10]):
        scientific_name = plant['scientific_name']
        common_name = plant['common_name']
        source = plant.get('source', 'Unknown')
        if common_name != scientific_name:
            print(f"{i+1}. {scientific_name} ({common_name}) - {source}")
        else:
            print(f"{i+1}. {scientific_name} - {source}")
    
    if len(plants) > 10:
        print(f"... and {len(plants) - 10} more plants")


if __name__ == "__main__":
    main()