import { describe, expect, it } from 'vitest'
import { connectionDriverReadiness } from './connectionDriverReadiness'
import { connectionProductType } from './productPresentation'
import { connectionEndpoint } from '@/components/sidebar/connectionPresentation'
import { useDriverStore } from '@/stores/driverStore'
import type { DriverDefinition, DriverInstallation } from '@/types/driver'
import type { ConnectionConfig } from '@/types/connection'
const driver = { id:'arbitrary-driver', productId:'arbitrary', backend:'jdbc', jdbcDriverClass:'example.Driver', defaultInstallationId:'v2', status:'configurable', capabilities:{canConnect:true} } as DriverDefinition
const installation = {id:'v1',driverDefinitionId:driver.id,artifacts:[{path:'/fixture.jar',sha256:null,role:'primary'}]} as DriverInstallation
const connection = {id:'fixture',name:'fixture',driverType:'jdbc',productId:'arbitrary',driverDefinitionId:driver.id,driverInstallationId:'v1',driverPaths:[]} as ConnectionConfig
const registry = {drivers:[driver],installations:[installation]}
describe('registry-based connection readiness and product context',()=>{
  it('uses pinned installation and definition class without copied legacy paths',()=>{
    expect(connectionDriverReadiness(connection,registry)).toBeNull()
    expect(connectionDriverReadiness({...connection,driverInstallationId:'deleted'},registry)).toBeTruthy()
    expect(connectionDriverReadiness({...connection,driverInstallationId:null},{...registry,installations:[installation,{...installation,id:'v2'}]})).toBeTruthy()
    expect(connectionDriverReadiness({...connection,driverDefinitionId:'deleted'},registry)).toBeTruthy()
    expect(connectionDriverReadiness(connection,{...registry,installations:[{...installation,driverDefinitionId:'other'}]})).toBeTruthy()
  })
  it('uses registered product adapter independently of a claimed dialect',()=>{
    useDriverStore.setState({products:[{id:'arbitrary',name:'Fixture',builtIn:false,iconKey:'jdbc',adapterId:'genericSql',defaultDriverDefinitionId:driver.id},{id:'postgres',name:'PostgreSQL',builtIn:true,iconKey:'postgres',adapterId:'postgresql',defaultDriverDefinitionId:'postgres'}]})
    expect(connectionProductType({...connection,driverDialect:'oracle'} as ConnectionConfig)).toBe('jdbc')
    expect(connectionProductType({...connection,productId:'postgres'})).toBe('postgres')
  })
  it('uses raw URL authority and hides all property values in endpoint display',()=>{
    const endpoint=connectionEndpoint({...connection,connectionMode:'urlOnly',host:'stale',connectionUrl:'jdbc:postgresql://alice:secret@host/db?token=hidden&mode=secure'})
    expect(endpoint).toContain('host/db')
    for(const secret of ['secret','hidden','secure','alice','stale']) expect(endpoint).not.toContain(secret)
  })
})
