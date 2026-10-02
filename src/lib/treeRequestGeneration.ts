export interface TreeRequestToken {
  generation: number
  token: number
  nodeId: string
  connectionId: string
}

export class TreeRequestGeneration {
  private generation = 0
  private readonly nodeTokens = new Map<string, number>()

  get viewRevision() {
    return this.generation
  }

  invalidateView() {
    this.generation += 1
    this.nodeTokens.clear()
  }

  begin(nodeId: string, connectionId: string): TreeRequestToken {
    const token = (this.nodeTokens.get(nodeId) ?? 0) + 1
    this.nodeTokens.set(nodeId, token)
    return { generation: this.generation, token, nodeId, connectionId }
  }

  isCurrent(request: TreeRequestToken, connectionId: string | null) {
    return request.generation === this.generation
      && request.connectionId === connectionId
      && this.nodeTokens.get(request.nodeId) === request.token
  }
}
