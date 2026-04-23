import { useState, useEffect, useCallback } from 'react'

export interface Resource {
    id: string
    name: string
    type: 'redis' | 'other'
    connection_url?: string
    description?: string
    tags: string[]
    status: 'online' | 'offline' | 'unknown'
    last_checked?: string
    created_at: string
    updated_at: string
}

export interface ResourceCreate {
    name: string
    type: string
    connection_url: string
    description?: string
    tags?: string[]
}

export interface ResourceUpdate {
    name?: string
    connection_url?: string
    description?: string
    tags?: string[]
}

const API_BASE = 'http://localhost:18888'

export function useResources() {
    const [resources, setResources] = useState<Resource[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const fetchResources = useCallback(async () => {
        try {
            setError(null)
            const response = await fetch(`${API_BASE}/resources`)
            if (!response.ok) throw new Error('Failed to fetch resources')
            const data = await response.json()
            setResources(data)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error')
            console.error('Failed to fetch resources:', err)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        fetchResources()
    }, [fetchResources])

    const createResource = async (resource: ResourceCreate): Promise<boolean> => {
        try {
            const response = await fetch(`${API_BASE}/resources`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(resource)
            })
            if (!response.ok) {
                const error = await response.json()
                throw new Error(error.detail || 'Failed to create resource')
            }
            await fetchResources()
            return true
        } catch (err) {
            console.error('Failed to create resource:', err)
            setError(err instanceof Error ? err.message : 'Unknown error')
            return false
        }
    }

    const updateResource = async (id: string, updates: ResourceUpdate): Promise<boolean> => {
        try {
            const response = await fetch(`${API_BASE}/resources/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
            })
            if (!response.ok) {
                const error = await response.json()
                throw new Error(error.detail || 'Failed to update resource')
            }
            await fetchResources()
            return true
        } catch (err) {
            console.error('Failed to update resource:', err)
            setError(err instanceof Error ? err.message : 'Unknown error')
            return false
        }
    }

    const deleteResource = async (id: string): Promise<boolean> => {
        try {
            const response = await fetch(`${API_BASE}/resources/${id}`, {
                method: 'DELETE'
            })
            if (!response.ok) throw new Error('Failed to delete resource')
            await fetchResources()
            return true
        } catch (err) {
            console.error('Failed to delete resource:', err)
            setError(err instanceof Error ? err.message : 'Unknown error')
            return false
        }
    }

    const testConnection = async (id: string): Promise<{ success: boolean; status?: string; error?: string }> => {
        try {
            const response = await fetch(`${API_BASE}/resources/${id}/test`, {
                method: 'POST'
            })
            const result = await response.json()
            await fetchResources() // Refresh to get updated status
            return result
        } catch (err) {
            console.error('Failed to test connection:', err)
            return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
        }
    }

    return {
        resources,
        loading,
        error,
        refresh: fetchResources,
        createResource,
        updateResource,
        deleteResource,
        testConnection
    }
}
