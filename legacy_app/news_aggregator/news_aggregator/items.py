import scrapy

class NewsAggregatorItem(scrapy.Item):
    title = scrapy.Field()
    link = scrapy.Field()
    date = scrapy.Field()
    source = scrapy.Field()
    summary = scrapy.Field()
    snippet = scrapy.Field()
    full_content = scrapy.Field()
    top_image = scrapy.Field()
    authors = scrapy.Field()
    keywords_found = scrapy.Field()
    word_count = scrapy.Field()
    method = scrapy.Field()