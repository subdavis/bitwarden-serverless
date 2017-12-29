# Bitwarden Serverless

[![Build Status](https://travis-ci.org/vvondra/bitwarden-serverless.svg?branch=master)](https://travis-ci.org/vvondra/bitwarden-serverless)

An alternative implementation of the [Bitwarden API](https://github.com/bitwarden/core) based on a AWS Serverless stack. Inspired by [bitwarden-ruby](https://github.com/jcs/bitwarden-ruby).

  - based on the [serverless](https://serverless.com/) framework
  - should run completely within AWS Free Tier limits
  - automatic multi-zone availability

## Setup

If you have AWS credentials set up, this should get you a running instance of the API. Just plug the AWS Gateway Service endpoint into your Bitwarden settings.

```bash
npm install -g serverless
npm install
serverless deploy
```

## Motivation

I really like the idea of bitwarden-ruby and hosting my secrets under my own control. Unfortunately I don't trust my VPSes in terms of availability and crash recovery enough to host all my passwords on them.

I do however trust AWS infrastructure and with the traffic pattern needed for a password manager, I can completely fit it in Free tier while gaining multi-zone availability and basically free regular backups.

## Development

The API is tested using blackbox integration tests against a fresh deployment on AWS.