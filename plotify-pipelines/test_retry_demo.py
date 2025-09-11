#!/usr/bin/env python3
"""
Test script to demonstrate the retry functionality by simulating failures.
"""

import requests
from bs4 import BeautifulSoup
import time
from datetime import datetime
import logging

class RetryDemo:
    def __init__(self):
        self.failed_links = []
        self.max_retries = 5
        
        # Setup logging
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(levelname)s - %(message)s',
            handlers=[
                logging.FileHandler('retry_demo.log'),
                logging.StreamHandler()
            ]
        )
        self.logger = logging.getLogger(__name__)
    
    def fetch_page_with_retry(self, url: str, retry_count: int = 0) -> BeautifulSoup:
        """Fetch and parse a web page with retry logic."""
        try:
            # Simulate some failures for demonstration
            if retry_count < 2 and "plant_id=3" in url:
                raise requests.RequestException("Simulated timeout for demonstration")
            
            response = requests.get(url, timeout=30)
            response.raise_for_status()
            return BeautifulSoup(response.content, 'html.parser')
        except requests.RequestException as e:
            if retry_count < self.max_retries:
                self.logger.warning(f"Attempt {retry_count + 1} failed for {url}: {e}. Retrying...")
                time.sleep(2 ** retry_count)  # Exponential backoff
                return self.fetch_page_with_retry(url, retry_count + 1)
            else:
                self.logger.error(f"Failed to fetch {url} after {self.max_retries} attempts: {e}")
                self.failed_links.append({
                    'url': url,
                    'error': str(e),
                    'timestamp': datetime.now().isoformat(),
                    'attempts': retry_count + 1
                })
                return None
    
    def test_retry_mechanism(self):
        """Test the retry mechanism with some URLs."""
        test_urls = [
            "https://www.smgrowers.com/products/plants/plantdisplay.asp?plant_id=2945",  # Should succeed
            "https://www.smgrowers.com/products/plants/plantdisplay.asp?plant_id=3",    # Will fail first 2 times
            "https://www.smgrowers.com/products/plants/plantdisplay.asp?plant_id=4282", # Should succeed
            "https://invalid-url-that-does-not-exist.com",  # Will fail completely
        ]
        
        self.logger.info("Testing retry mechanism...")
        
        for i, url in enumerate(test_urls):
            self.logger.info(f"Testing URL {i+1}: {url}")
            soup = self.fetch_page_with_retry(url)
            if soup:
                self.logger.info(f"Successfully fetched: {url}")
            else:
                self.logger.error(f"Failed to fetch: {url}")
        
        # Show results
        self.logger.info(f"Total failed links: {len(self.failed_links)}")
        for failed in self.failed_links:
            self.logger.info(f"Failed: {failed['url']} - {failed['error']} (attempts: {failed['attempts']})")

if __name__ == "__main__":
    demo = RetryDemo()
    demo.test_retry_mechanism()
