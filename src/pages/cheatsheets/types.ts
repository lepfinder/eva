import type { ReactNode } from 'react'

export interface CheatItem {
  command: string
  description: string
}

export interface CheatSection {
  title: string
  items: CheatItem[]
}

export interface CheatSoftware {
  id: string
  name: string
  description: string
  icon: ReactNode
  color: string
  sectionColors: string[]
  sections: CheatSection[]
}
