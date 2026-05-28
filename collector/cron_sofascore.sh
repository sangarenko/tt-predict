#!/bin/bash
# Cron job for SofaScore scanner
# Run every 10 minutes to check for void match results
# Install: crontab -e → paste this line

# Every 10 minutes
# */10 * * * * cd /var/www/tt-predict && /usr/bin/python3 collector/sofascore_scanner.py --pages 3 >> /var/www/tt-predict/logs/sofascore_cron.log 2>&1

# Every 30 minutes (recommended - less aggressive)
*/30 * * * * cd /var/www/tt-predict && /usr/bin/python3 collector/sofascore_scanner.py --pages 3 >> /var/www/tt-predict/logs/sofascore_cron.log 2>&1

# Every hour (conservative)
# 0 * * * * cd /var/www/tt-predict && /usr/bin/python3 collector/sofascore_scanner.py --pages 5 >> /var/www/tt-predict/logs/sofascore_cron.log 2>&1
