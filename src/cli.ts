#!/usr/bin/env node
import process from 'node:process'
import { runCli } from './cli/run.ts'

process.exitCode = await runCli(process.argv)
